"""Case-scoped review of verified Quanti IHC cell detections."""

import asyncio
import json
import re
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID, uuid4

import openslide
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, StringConstraints
from sqlalchemy import String, select

from app.auth import CurrentUser, Session
from app.cell_overlay import BUCKET, density_grid, tile_page
from app.clinical import ClinicalInput, add_event
from app.her2 import SCHEMAS, clinical_display
from app.ihc_archive import approved_rule, aggregate, archive_cells, archive_folder, counts_at, digest, load_cells
from app.models import AuthUser, Case, IhcResultRevision, Slide, SlideScan
from app.pdl1 import MAX_POINTS, Coordinate, SnapshotId, scan_signature
from app.scan_quality import BLOCKED_QC
from app.viewer_records import ANNOTATORS
from app.wsi import PRIVATE, Source, lock_scan_case, registered_path, verified_scan_path, visible_scan

router = APIRouter(prefix="/api/wsi", tags=["IHC Results"])
Revision = IhcResultRevision
CellId = Annotated[str, StringConstraints(pattern=r"^(0|[1-9][0-9]{0,8})$")]
Grade = Annotated[int, Field(strict=True, ge=0, le=4)]
Threshold = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]


class ReviewChange(ClinicalInput):
    action: Literal["edit", "restore"]
    expected_version: Annotated[int, Field(ge=0)]
    request_key: UUID
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
    threshold: Threshold | None = None
    changes: dict[CellId, Grade | None] = Field(default_factory=dict, max_length=250)


def find_archive(path, organization):
    if not archive_folder(organization, {}).parent.is_dir():
        return None
    try:
        stat = path.stat()
        signature = scan_signature(path, stat.st_size, stat.st_mtime_ns)
    except (OSError, openslide.OpenSlideError, ValueError):
        return None
    return archive_folder(organization, signature)


def manifest(folder, source_id):
    try:
        result = json.loads((folder / source_id / "manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise HTTPException(404, "IHC source result not found.") from None
    except (OSError, ValueError):
        raise HTTPException(503, "IHC source result is unavailable.") from None
    if result.get("id") != source_id:
        raise HTTPException(503, "IHC source result is unavailable.")
    return result


def manifests(folder):
    if folder is None:
        return []
    return [manifest(folder, item.name) for item in sorted(folder.iterdir())
            if item.is_dir() and re.fullmatch(r"[a-f0-9]{64}", item.name)] if folder.is_dir() else []


def revisions(user, case_id, scan_id, source_id):
    return select(Revision).where(Revision.organization == user.organization, Revision.case_id == case_id, Revision.scan_id == scan_id,
                                  Revision.source_id == source_id)


async def selected_revision(session, user, case_id, scan_id, source_id, version):
    if version == 0:
        return None
    row = None
    if case_id and user.role != "labeler":
        row = await session.scalar(revisions(user, case_id, scan_id, source_id).where(Revision.version == version))
    if row is None:
        raise HTTPException(404, "IHC revision not found.")
    return row


def load_index(folder):
    try:
        return archive_cells(folder)
    except (OSError, ValueError):
        raise HTTPException(503, "IHC cell data is unavailable.") from None


def display_state(folder, organization, stain, original, revision):
    rows, _, confidences = load_index(folder / original["id"])
    threshold = revision.threshold if revision else original["default_threshold"]
    overrides = revision.overrides if revision else {}
    counts = counts_at(rows, confidences, threshold, overrides)
    aligned = original.get("replay_aligned") is True
    original_state = threshold == original["default_threshold"] and not overrides
    if original_state:
        counts = original["original_counts"]
    if original["marker"] == "her2":
        return {"threshold": threshold, "counts": counts, "override_count": len(overrides),
                "count_basis": "original" if original_state else "review",
                **clinical_display(folder / original["id"], stain, original, revision, aligned)}
    approval = approved_rule(organization, stain, original, threshold, overrides) if aligned else None
    output = None if approval is None else aggregate(approval["rule"], counts, approval["minimum_tumor_cells"])
    status = ("source_replay_unverified" if not aligned else "approval_required" if approval is None
              else "available" if output else "insufficient_cells")
    return {"threshold": threshold, "counts": counts, "override_count": len(overrides),
            "count_basis": "original" if original_state else "review",
            "approval": approval["reference"] if approval else None,
            "status": status,
            "rule": approval["rule"] if approval else None, "aggregate": output}


@router.get("/{source}/{scan_id}/ihc")
async def results(source: Source, scan_id: UUID, user: CurrentUser, session: Session, response: Response):
    response.headers.update(PRIVATE)
    path = await registered_path(source, scan_id, user, session)
    folder = await asyncio.to_thread(find_archive, path, user.organization)
    entries = await asyncio.to_thread(manifests, folder)
    public = [{key: value for key, value in item.items() if key != "source_value"} for item in entries]
    return {"results": public, "can_review": source == "clinical" and user.role in ANNOTATORS}


@router.get("/{source}/{scan_id}/ihc/{source_id}")
async def details(source: Source, scan_id: UUID, source_id: SnapshotId, user: CurrentUser, session: Session,
                  response: Response, version: Annotated[int, Query(ge=0)] | None = None):
    response.headers.update(PRIVATE)
    path = await registered_path(source, scan_id, user, session)
    folder = await asyncio.to_thread(find_archive, path, user.organization)
    if folder is None:
        raise HTTPException(404, "IHC source result not found.")
    original = await asyncio.to_thread(manifest, folder, source_id)
    history = []
    stain = case_id = None
    if source == "clinical" and user.role != "labeler":
        context = (await session.execute(visible_scan(user, scan_id, Case.id, Slide.stain))).one_or_none()
        if context is None:
            raise HTTPException(404, "Registered WSI not found.")
        case_id, stain = context
        stain = re.sub(r"[^a-z0-9]", "", (stain or "").lower())
        timeline = revisions(user, case_id, scan_id, source_id).with_only_columns(
            Revision.version, Revision.action, Revision.reason, Revision.threshold, Revision.created_at,
            AuthUser.display_name.label("actor"),
        ).outerjoin(AuthUser, (AuthUser.organization == Revision.organization)
                    & (AuthUser.id.cast(String) == Revision.created_by)).order_by(Revision.version.desc())
        history = [dict(row) for row in (await session.execute(timeline)).mappings()]
    latest = history[0]["version"] if history else 0
    version = latest if version is None else version
    review = await selected_revision(session, user, case_id, scan_id, source_id, version)
    state = await asyncio.to_thread(display_state, folder, user.organization, stain, original, review)
    return {**state, "version": version, "latest_version": latest, "history": history}


def review_point(rows, index, threshold, overrides):
    x, y, base_grade, confidence = rows[index]
    override = overrides.get(index)
    if override is None and confidence < threshold:
        return None
    return [x, y, base_grade if override is None else override, index, confidence, base_grade, override is not None]


def visible_cells(folder, threshold, overrides, left, top, right, bottom):
    rows, buckets, _ = load_index(folder)
    points = []
    for (bx, by), indices in buckets.items():
        if (bx + 1) * BUCKET <= left or (by + 1) * BUCKET <= top or bx * BUCKET >= right or by * BUCKET >= bottom:
            continue
        for index in indices:
            point = review_point(rows, index, threshold, overrides)
            if point is None or not (left <= point[0] < right and top <= point[1] < bottom):
                continue
            if len(points) == MAX_POINTS:
                return {"points": points, "truncated": True}
            points.append(point)
    return {"points": points, "truncated": False}


async def overlay_context(source, scan_id, source_id, user, session, version):
    path = await registered_path(source, scan_id, user, session)
    folder = await asyncio.to_thread(find_archive, path, user.organization)
    if folder is None:
        raise HTTPException(404, "IHC source result not found.")
    original = await asyncio.to_thread(manifest, folder, source_id)
    case_id = await session.scalar(visible_scan(user, scan_id, Case.id)) if source == "clinical" else None
    if source == "clinical" and case_id is None:
        raise HTTPException(404, "Registered WSI not found.")
    revision = await selected_revision(session, user, case_id, scan_id, source_id, version)
    threshold = revision.threshold if revision else original["default_threshold"]
    overrides = {int(index): grade for index, grade in revision.overrides.items()} if revision else {}
    await session.rollback()
    return folder / source_id, tuple(original["dimensions"]), threshold, overrides


@router.get("/{source}/{scan_id}/ihc/{source_id}/cells")
async def cells(source: Source, scan_id: UUID, source_id: SnapshotId, user: CurrentUser, session: Session,
                response: Response, left: Coordinate, top: Coordinate, right: Coordinate, bottom: Coordinate,
                version: Annotated[int, Query(ge=0)] = 0):
    response.headers.update(PRIVATE)
    if left >= right or top >= bottom:
        raise HTTPException(422, "Check the display area.")
    folder, _, threshold, overrides = await overlay_context(source, scan_id, source_id, user, session, version)
    return await asyncio.to_thread(visible_cells, folder, threshold, overrides, left, top, right, bottom)


@lru_cache(maxsize=12)
def cached_density(path, modified_ns, dimensions, threshold, edits):
    rows, buckets, _ = load_cells(path, modified_ns)
    overrides = dict(edits)
    return density_grid(buckets, dimensions, lambda index: review_point(rows, index, threshold, overrides))


def build_overlay(folder, dimensions, threshold, overrides, bx, by, offset):
    if bx is None:
        path = folder / "cells.json"
        try:
            return cached_density(path, path.stat().st_mtime_ns, dimensions, threshold, tuple(sorted(overrides.items())))
        except (OSError, ValueError):
            raise HTTPException(503, "IHC cell data is unavailable.") from None
    rows, buckets, _ = load_index(folder)
    return tile_page(buckets.get((bx, by), ()), offset, lambda index: review_point(rows, index, threshold, overrides))


@router.get("/{source}/{scan_id}/ihc/{source_id}/overlay")
async def overlay(source: Source, scan_id: UUID, source_id: SnapshotId, user: CurrentUser, session: Session,
                  response: Response, version: Annotated[int, Query(ge=0)] = 0,
                  bx: Annotated[int, Query(ge=0, le=500_000)] | None = None,
                  by: Annotated[int, Query(ge=0, le=500_000)] | None = None,
                  offset: Annotated[int, Query(ge=0)] = 0):
    response.headers.update(PRIVATE)
    if (bx is None) != (by is None) or (bx is None and offset):
        raise HTTPException(422, "Check the overlay tile.")
    context = await overlay_context(source, scan_id, source_id, user, session, version)
    return await asyncio.to_thread(build_overlay, *context, bx, by, offset)


@router.post("/{source}/{scan_id}/ihc/{source_id}/revisions")
async def revise(source: Source, scan_id: UUID, source_id: SnapshotId, payload: ReviewChange,
                 user: CurrentUser, session: Session, response: Response):
    response.headers.update(PRIVATE)
    if source != "clinical" or user.role not in ANNOTATORS:
        raise HTTPException(403, "IHC review requires case review permission.")
    path = await registered_path(source, scan_id, user, session)
    folder = await asyncio.to_thread(find_archive, path, user.organization)
    if folder is None:
        raise HTTPException(404, "IHC source result not found.")
    original = await asyncio.to_thread(manifest, folder, source_id)
    case_id = await lock_scan_case(session, user, scan_id)
    if await session.scalar(visible_scan(user, scan_id, Slide.id).where(Case.id == case_id)
                            .with_for_update(read=True, of=Slide)) is None:
        raise HTTPException(409, "The scan moved to a different case.")
    scan = await session.scalar(visible_scan(user, scan_id, SlideScan).where(Case.id == case_id).with_for_update(of=SlideScan))
    if scan is None or scan.qc_status in BLOCKED_QC:
        raise HTTPException(409, "Scan unavailable for review.")
    current_path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    if current_path != path or await asyncio.to_thread(find_archive, current_path, user.organization) != folder:
        raise HTTPException(409, "The scan changed. Reopen it before reviewing.")
    base_query = revisions(user, case_id, scan_id, source_id)
    actor = str(user.id)
    request_hash = digest(json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode())
    existing = await session.scalar(base_query.where(Revision.created_by == actor, Revision.request_key == payload.request_key))
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, "This review request key is already in use.")
        return {"version": existing.version}
    previous = await session.scalar(base_query.order_by(Revision.version.desc()).limit(1))
    version = previous.version if previous else 0
    if payload.expected_version != version:
        raise HTTPException(409, "The review changed. Reload the latest version before saving.")
    threshold = previous.threshold if previous else original["default_threshold"]
    before_overrides = previous.overrides if previous else {}
    overrides = dict(before_overrides)
    if payload.action == "restore":
        if not previous or payload.changes or payload.threshold is not None:
            raise HTTPException(422, "Restore requires an existing review and no cell or threshold changes.")
        next_threshold, overrides = original["default_threshold"], {}
    else:
        next_threshold = threshold if payload.threshold is None else payload.threshold
        for key, grade in payload.changes.items():
            if int(key) >= original["point_count"]:
                raise HTTPException(422, "Cell is absent from this IHC source result.")
            if (grade is not None and original.get("score_schema") in SCHEMAS
                    and grade >= len(SCHEMAS[original["score_schema"]])):
                raise HTTPException(422, "That cell decision is outside the source classification schema.")
            if grade is None:
                overrides.pop(key, None)
            else:
                overrides[key] = grade
        if threshold == next_threshold and before_overrides == overrides:
            raise HTTPException(422, "Change the confidence threshold or a cell decision before saving.")
    if len(overrides) > 10000:
        raise HTTPException(422, "This result supports up to 10,000 reviewed cells.")
    row = Revision(id=uuid4(), organization=user.organization, case_id=case_id, scan_id=scan_id,
                   source_id=source_id, version=version + 1, action=payload.action, threshold=next_threshold,
                   overrides=overrides, reason=payload.reason, request_key=payload.request_key,
                   request_hash=request_hash, created_by=actor)
    session.add(row)
    session.info["user"] = user
    add_event(session, row, "ihc_result_restored" if payload.action == "restore" else "ihc_result_edited",
              {"revision": version, "threshold": threshold, "override_count": len(before_overrides)},
              {"revision": row.version, "threshold": next_threshold, "override_count": len(overrides),
               "scan_id": str(scan_id), "source_id": source_id}, reason=payload.reason, case_id=case_id)
    await session.commit()
    return {"version": row.version}
