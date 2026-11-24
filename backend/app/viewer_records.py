"""Persist viewer state in the source slide's unscaled level-0 pixel coordinates."""

import math
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field, StringConstraints
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session, require_roles
from app.clinical import ClinicalInput, add_event
from app.models import AuthUser, ViewerAnnotation, ViewerPosition
from app.wsi import PRIVATE, Source, lock_scan_case, registered_file, scan_response

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
    kind: Literal["rectangle", "distance"]
    points: tuple[tuple[Coordinate, Coordinate], tuple[Coordinate, Coordinate]]
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)] = ""


def measure(points, mpp_x, mpp_y):
    (x1, y1), (x2, y2) = points
    if mpp_x is not None and mpp_y is not None:
        return math.hypot((x2 - x1) * mpp_x, (y2 - y1) * mpp_y), "um"
    return math.hypot(x2 - x1, y2 - y1), "px"


def check_point(x, y, dimensions):
    if not (0 <= x < dimensions[0] and 0 <= y < dimensions[1]):
        raise HTTPException(422, "Coordinates are outside the scan image.")


def position_result(position):
    return {key: getattr(position, key) for key in ("x", "y", "zoom", "version", "saved_at")}


def annotation_result(row, actor_name, user):
    view = {key: getattr(row, key) for key in (
        "id", "kind", "points", "label", "length", "unit", "mpp_x", "mpp_y", "created_at", "version",
    )}
    return {**view, "author": actor_name, "can_delete": user.role == "admin" or (user.role == "doctor" and user.id == row.author_id)}


def scope_for(scan_key, user):
    return (ViewerAnnotation.organization == user.organization, ViewerAnnotation.scan_key == scan_key)


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
            "annotations": [annotation_result(row, name, user) for row, name in rows]}


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
    (x1, y1), (x2, y2) = points
    if (data.kind == "rectangle" and (x1 == x2 or y1 == y2)) or points[0] == points[1]:
        raise HTTPException(422, "Select two valid points for the measurement or ROI.")
    mpp_x, mpp_y = info["mpp_x"], info["mpp_y"]
    length, unit = measure(points, mpp_x, mpp_y) if data.kind == "distance" else (None, None)
    async with session.begin():
        case_id = await write_scope(source, scan_id, session, user)
        created = await session.scalar(insert(ViewerAnnotation).values(
            id=data.id, organization=user.organization, scan_key=key, author_id=user.id, kind=data.kind,
            points=points, label=data.label, length=length, unit=unit, mpp_x=mpp_x, mpp_y=mpp_y, version=1,
        ).on_conflict_do_nothing().returning(ViewerAnnotation))
        if created is not None:
            add_event(session, created, "annotation_registered", {}, annotation_snapshot(created, scan_id, source),
                      source="viewer", case_id=case_id)
            return annotation_result(created, user.display_name, user)
        existing = await session.scalar(select(ViewerAnnotation).where(
            *scope_for(key, user), ViewerAnnotation.id == data.id, ViewerAnnotation.author_id == user.id,
            ViewerAnnotation.deleted_at.is_(None),
        ))
        if existing and (existing.points, existing.kind, existing.label) == (points, data.kind, data.label):
            return annotation_result(existing, user.display_name, user)
        raise HTTPException(409, "This save ID belongs to a different annotation.")


class AnnotationUpdate(ClinicalInput):
    version: Annotated[int, Field(ge=1)]
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]


def annotation_snapshot(annotation, scan_id, source):
    return {
        "kind": annotation.kind, "points": annotation.points, "label": annotation.label,
        "length": annotation.length, "unit": annotation.unit, "deleted": annotation.deleted_at is not None,
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
                      source="viewer", case_id=case_id)
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
                      source="viewer", case_id=case_id)
    return {"ok": True}
