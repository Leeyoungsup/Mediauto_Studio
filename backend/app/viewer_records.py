"""Persist viewer state in the source slide's unscaled level-0 pixel coordinates."""

import math
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field, StringConstraints
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session, require_roles
from app.case_activity import attempt_id, record_activity
from app.clinical import ClinicalInput, add_event
from app.models import AuthUser, Case, ViewerAnnotation, ViewerPosition
from app.wsi import PRIVATE, Source, lock_scan_case, registered_file, scan_response, visible_scan

router = APIRouter(prefix="/api/wsi/{source}/{scan_id}/viewer-records", tags=["Viewer records"])
ANNOTATORS = ("admin", "doctor")
Coordinate = Annotated[float, Field(ge=0, le=1_000_000_000, allow_inf_nan=False)]


class Position(ClinicalInput):
    x: Coordinate
    y: Coordinate
    zoom: Annotated[float, Field(gt=0, le=64, allow_inf_nan=False)]
    version: Annotated[int, Field(ge=0)]


class Annotation(ClinicalInput):
    id: UUID
    kind: Literal["rectangle", "distance", "ellipse", "arrow", "point", "polygon", "brush", "count", "bookmark"]
    points: Annotated[list[tuple[Coordinate, Coordinate]], Field(min_length=1, max_length=256)]
    zoom: Annotated[float, Field(gt=0, le=64, allow_inf_nan=False)] | None = None
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)] = ""


def measure(points, mpp_x, mpp_y):
    dx_scale, dy_scale = (mpp_x, mpp_y) if mpp_x and mpp_y else (1, 1)
    length = sum(math.hypot((x2 - x1) * dx_scale, (y2 - y1) * dy_scale)
                 for (x1, y1), (x2, y2) in zip(points, points[1:]))
    return length, "um" if mpp_x and mpp_y else "px"


def check_polygon(points):
    if len({tuple(point) for point in points}) != len(points):
        raise HTTPException(422, "Use a different position for each vertex.")

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def within(p, a, b):
        return all(min(start, end) <= value <= max(start, end) for value, start, end in zip(p, a, b))

    edges = list(zip(points, points[1:] + points[:1]))
    for i, (a, b) in enumerate(edges):
        # Adjacent edges share a vertex, including the first and last edge.
        for j in range(i + 2, len(edges) - (i == 0)):
            c, d = edges[j]
            ac, ad, ca, cb = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
            if ((ac * ad < 0 and ca * cb < 0) or (ac == 0 and within(c, a, b)) or (ad == 0 and within(d, a, b))
                    or (ca == 0 and within(a, c, d)) or (cb == 0 and within(b, c, d))):
                raise HTTPException(422, "Polygon edges cannot cross or touch.")
    xs, ys = zip(*points)
    bounds_area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    twice_area = sum(cross(points[0], a, b) for a, b in edges)
    if abs(twice_area) <= bounds_area * 1e-12:
        raise HTTPException(422, "The polygon must enclose an area.")


def check_geometry(kind, points, zoom):
    count = len(points)
    if kind in ("rectangle", "ellipse", "arrow") and count != 2:
        raise HTTPException(422, "This tool requires exactly two points.")
    if kind in ("point", "bookmark") and count != 1:
        raise HTTPException(422, "This tool requires one point.")
    if (kind in ("brush", "distance") and count < 2) or (kind == "polygon" and count < 3):
        raise HTTPException(422, "Add more points before saving the annotation.")
    if any(a == b for a, b in zip(points, points[1:])):
        raise HTTPException(422, "Consecutive points must be different.")
    if kind == "polygon":
        check_polygon(points)
    if kind in ("rectangle", "ellipse"):
        axes = tuple(zip(*points))
        if any(min(axis) == max(axis) for axis in axes):
            raise HTTPException(422, "The ROI must cover both image axes.")
    if (kind == "bookmark") != (zoom is not None):
        raise HTTPException(422, "Only a bookmark requires a saved zoom.")

def check_point(x, y, dimensions):
    if not (0 <= x < dimensions[0] and 0 <= y < dimensions[1]):
        raise HTTPException(422, "Coordinates are outside the scan image.")


def position_result(position):
    return {key: getattr(position, key) for key in ("x", "y", "zoom", "version", "saved_at")}


def annotation_result(row, actor_name, user):
    view = {key: getattr(row, key) for key in (
        "id", "kind", "points", "label", "length", "unit", "mpp_x", "mpp_y", "created_at", "version", "zoom",
    )}
    return {**view, "author": actor_name, "can_delete": user.role == "admin" or (user.role == "doctor" and user.id == row.author_id)}


def scope_for(scan_key, user):
    return (ViewerAnnotation.organization == user.organization, ViewerAnnotation.scan_key == scan_key,
            or_(ViewerAnnotation.kind != "bookmark", ViewerAnnotation.author_id == user.id))


async def write_scope(source, scan_id, session, user):
    session.info["user"] = user
    if source == "clinical":
        return await lock_scan_case(session, user, scan_id)
    return None


@router.get("")
async def read_records(source: Source, scan_id: UUID, user: CurrentUser, session: Session, response: Response):
    response.headers.update(PRIVATE)
    _, key = await registered_file(source, scan_id, user, session)
    position = await session.get(ViewerPosition, (user.organization, key, user.id))
    rows = await session.execute(select(ViewerAnnotation, AuthUser.display_name)
        .join(AuthUser, ViewerAnnotation.author_id == AuthUser.id)
        .where(*scope_for(key, user), ViewerAnnotation.deleted_at.is_(None))
        .order_by(ViewerAnnotation.created_at, ViewerAnnotation.id))
    return {"position": position_result(position) if position else None, "can_annotate": user.role in ANNOTATORS,
            "can_export": user.role in ANNOTATORS, "annotations": [annotation_result(row, name, user) for row, name in rows]}


@router.put("/position")
async def save_position(source: Source, scan_id: UUID, data: Position, user: CurrentUser, session: Session, request: Request):
    path, key = await registered_file(source, scan_id, user, session)
    info = await scan_response(request, path, "metadata")
    check_point(data.x, data.y, info["dimensions"])
    identity = {"organization": user.organization, "scan_key": key, "user_id": user.id}
    values = {"x": data.x, "y": data.y, "zoom": data.zoom, "version": data.version + 1}
    async with session.begin():
        await write_scope(source, scan_id, session, user)
        if data.version == 0:
            command = insert(ViewerPosition).values(**identity, **values).on_conflict_do_nothing()
        else:
            command = update(ViewerPosition).filter_by(**identity, version=data.version).values(**values, saved_at=func.now())
        position = await session.scalar(command.returning(ViewerPosition))
        if position is None:
            raise HTTPException(409, "The position was changed in another session. Reload the saved position.")
        return position_result(position)


@router.post("/annotations", status_code=201)
async def create_annotation(source: Source, scan_id: UUID, data: Annotation, user: CurrentUser, session: Session, request: Request):
    require_roles(user, ANNOTATORS)
    path, key = await registered_file(source, scan_id, user, session)
    info = await scan_response(request, path, "metadata")
    points = data.model_dump(mode="json")["points"]
    for x, y in points:
        check_point(x, y, info["dimensions"])
    check_geometry(data.kind, points, data.zoom)
    mpp_x, mpp_y = info["mpp_x"], info["mpp_y"]
    length, unit = measure(points, mpp_x, mpp_y) if data.kind == "distance" else (None, None)
    async with session.begin():
        case_id = await write_scope(source, scan_id, session, user)
        created = await session.scalar(insert(ViewerAnnotation).values(
            id=data.id, organization=user.organization, scan_key=key, author_id=user.id, kind=data.kind,
            points=points, label=data.label, length=length, unit=unit, mpp_x=mpp_x, mpp_y=mpp_y, version=1, zoom=data.zoom,
        ).on_conflict_do_nothing().returning(ViewerAnnotation))
        if created is not None:
            add_event(session, created, "annotation_registered", {}, annotation_snapshot(created, scan_id, source),
                      source="viewer", case_id=case_id if created.kind != "bookmark" else None)
            return annotation_result(created, user.display_name, user)
        existing = await session.scalar(select(ViewerAnnotation).where(
            *scope_for(key, user), ViewerAnnotation.id == data.id, ViewerAnnotation.author_id == user.id,
            ViewerAnnotation.deleted_at.is_(None),
        ))
        if existing and (existing.points, existing.kind, existing.label) == (points, data.kind, data.label) and existing.zoom == data.zoom:
            return annotation_result(existing, user.display_name, user)
        raise HTTPException(409, "This save ID belongs to a different annotation.")


class AnnotationUpdate(ClinicalInput):
    version: Annotated[int, Field(ge=1)]
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]


def annotation_snapshot(annotation, scan_id, source):
    return {
        "kind": annotation.kind, "points": annotation.points, "label": annotation.label,
        "length": annotation.length, "unit": annotation.unit, "zoom": annotation.zoom, "deleted": annotation.deleted_at is not None,
        "scan_id": str(scan_id), "scan_source": source,
    }


async def editable_annotation(session, key, user, annotation_id):
    annotation = await session.scalar(select(ViewerAnnotation).where(
        *scope_for(key, user), ViewerAnnotation.id == annotation_id,
    ).with_for_update())
    if annotation is None:
        raise HTTPException(404, "Annotation not found for this scan.")
    if annotation.author_id != user.id and user.role != "admin":
        raise HTTPException(403, "You can change only the annotations you created.")
    return annotation


@router.patch("/annotations/{annotation_id}")
async def edit_annotation(source: Source, scan_id: UUID, annotation_id: UUID, data: AnnotationUpdate,
                          user: CurrentUser, session: Session):
    require_roles(user, ANNOTATORS)
    _, key = await registered_file(source, scan_id, user, session)
    async with session.begin():
        case_id = await write_scope(source, scan_id, session, user)
        annotation = await editable_annotation(session, key, user, annotation_id)
        if annotation.deleted_at is not None:
            raise HTTPException(409, "This annotation has been deleted. Refresh saved records.")
        if annotation.version != data.version:
            raise HTTPException(409, "This annotation has changed. Refresh saved records.")
        if annotation.label != data.label:
            before = annotation_snapshot(annotation, scan_id, source)
            annotation.label = data.label
            annotation.version += 1
            add_event(session, annotation, "annotation_updated", before, annotation_snapshot(annotation, scan_id, source),
                      source="viewer", case_id=case_id if annotation.kind != "bookmark" else None)
        author = await session.get(AuthUser, annotation.author_id)
        return annotation_result(annotation, author.display_name, user)


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(source: Source, scan_id: UUID, annotation_id: UUID, user: CurrentUser, session: Session):
    require_roles(user, ANNOTATORS)
    _, key = await registered_file(source, scan_id, user, session)
    async with session.begin():
        case_id = await write_scope(source, scan_id, session, user)
        annotation = await editable_annotation(session, key, user, annotation_id)
        if annotation.deleted_at is None:
            before = annotation_snapshot(annotation, scan_id, source)
            annotation.deleted_at = datetime.now(timezone.utc)
            annotation.version += 1
            add_event(session, annotation, "annotation_deleted", before, annotation_snapshot(annotation, scan_id, source),
                      source="viewer", case_id=case_id if annotation.kind != "bookmark" else None)
    return {"ok": True}



@router.get("/annotations/{annotation_id}/capture.png")
async def export_roi(source: Source, scan_id: UUID, annotation_id: UUID, request: Request,
                     user: CurrentUser, session: Session, annotations: bool = True, scale_bar: bool = True):
    require_roles(user, ANNOTATORS)
    path, key = await registered_file(source, scan_id, user, session)
    row = await session.scalar(select(ViewerAnnotation).where(
        *scope_for(key, user), ViewerAnnotation.id == annotation_id, ViewerAnnotation.deleted_at.is_(None),
    ))
    if row is None:
        raise HTTPException(404, "ROI not found for this scan.")
    if row.kind not in ("rectangle", "ellipse", "polygon", "brush"):
        raise HTTPException(422, "Choose an area ROI to export.")
    geometry = (row.kind, row.points, annotations, scale_bar)
    case_id = await session.scalar(visible_scan(user, scan_id, Case.id)) if source == "clinical" else None
    if source == "clinical" and case_id is None:
        raise HTTPException(404, "Registered WSI not found.")
    await session.rollback()
    image = await scan_response(request, path, "capture", geometry)
    if case_id:
        async with session.begin():
            current_case = await lock_scan_case(session, user, scan_id)
            if current_case != case_id:
                raise HTTPException(409, "The scan changed cases while the export was rendering.")
            await record_activity(session, user, case_id, "roi_capture_exported", "annotation", annotation_id,
                                  attempt_id(request))
    image.headers["Content-Disposition"] = f'attachment; filename="roi-{annotation_id}.png"'
    return image
