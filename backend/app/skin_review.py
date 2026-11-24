"""Slide-scoped dermatopathology overlays and append-only counting reviews."""

import asyncio
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

import openslide
from fastapi import APIRouter, HTTPException, Path as RoutePath, Response
from pydantic import Field
from sqlalchemy import String, select

from app.auth import CurrentUser, Session
from app.clinical import ClinicalInput, Reason, add_event
from app.intake import source_id as scan_fingerprint
from app.models import AuthUser, Case, SkinReviewRevision, Slide, SlideScan, Specimen
from app.scan_quality import BLOCKED_QC
from app.skin_archive import (Archive, Binding, CandidateStatus, IDENTIFIER, Point, area_mm2, contains,
                              folder_for, read_archives, read_references, scales_match, slide_context)
from app.viewer_records import ANNOTATORS
from app.wsi import PRIVATE, lock_scan_case, registered_file, verified_scan_path, visible_scan

router = APIRouter(prefix="/api/wsi/clinical/{scan_id}/skin", tags=["Skin Review"])
SourceId = Annotated[str, RoutePath(pattern=r"^(manual-)?[a-f0-9]{64}$")]
Revision = SkinReviewRevision


class ReviewChange(ClinicalInput):
    expected_version: Annotated[int, Field(strict=True, ge=0)]
    request_key: UUID
    reason: Reason


class PlaceWindow(ReviewChange):
    action: Literal["window"]
    point: Point
    area: Literal[0.2, 1.0]


class RemoveWindow(ReviewChange):
    action: Literal["remove_window"]
    window_id: IDENTIFIER


class AddCandidate(ReviewChange):
    action: Literal["add"]
    point: Point
    window_id: IDENTIFIER


class DecideCandidate(ReviewChange):
    action: Literal["decide"]
    candidate_id: IDENTIFIER
    window_id: IDENTIFIER
    status: CandidateStatus


Change = Annotated[PlaceWindow | RemoveWindow | AddCandidate | DecideCandidate, Field(discriminator="action")]


@dataclass
class SkinContext:
    binding: Binding
    dimensions: list[int]
    mpp: tuple[float, float] | None
    manual_id: str
    fingerprint: UUID
    folder: Path
    archives: dict[str, Archive]
    archive_failed: bool = False


def context_for(path, organization, binding, fingerprint):
    signature, mpp = slide_context(path)
    folder = folder_for(organization, signature)
    manual_key = hashlib.sha256(f"{fingerprint}:{binding.model_dump_json()}".encode()).hexdigest()
    try:
        archives, failed = read_archives(folder, binding, signature), False
    except (OSError, ValueError):
        archives, failed = {}, True
    return SkinContext(binding, signature["dimensions"], mpp, "manual-" + manual_key,
                       fingerprint, folder, archives, failed)


async def scan_binding(session, user, scan_id, case_id=None, lock=False):
    query = visible_scan(user, scan_id, Case.id, Specimen.id, Slide.id, Slide.block_id, Slide.stain)
    if lock:
        query = query.where(Case.id == case_id).with_for_update(read=True, of=(Slide, Specimen))
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise HTTPException(404, "Registered WSI not found.")
    case_id, specimen_id, slide_id, block_id, stain = row
    if re.sub(r"[^a-z]", "", (stain or "").lower()) not in ("he", "hematoxylinandeosin"):
        return None
    return Binding(case_id=case_id, specimen_id=specimen_id, slide_id=slide_id, block_id=block_id)


async def load_context(scan_id, user, session):
    path, fingerprint = await registered_file("clinical", scan_id, user, session)
    binding = await scan_binding(session, user, scan_id)
    if binding is None:
        return path, None
    await session.rollback()
    try:
        context = await asyncio.to_thread(context_for, path, user.organization, binding, fingerprint)
    except (ValueError, OSError, openslide.OpenSlideError) as error:
        raise HTTPException(503, "Skin analysis could not be verified for this scan.") from error
    return path, context


def archive_for(context, source_id):
    if context is None or (source_id != context.manual_id and source_id not in context.archives):
        raise HTTPException(404, "Skin review source not found.")
    return context.archives.get(source_id)


def query_reviews(user, scan_id, source_id, case_id):
    return select(Revision).where(Revision.organization == user.organization, Revision.case_id == case_id,
                                  Revision.scan_id == scan_id, Revision.source_id == source_id)


def initial_state():
    return {"windows": {}, "manual": {}, "decisions": {}}


def source_items(archive, state):
    windows = {row.id: row.bounds for row in archive.windows} if archive else {}
    marks = {row.id: {"point": row.point, "confidence": row.confidence} for row in archive.candidates} if archive else {}
    windows.update(state["windows"])
    marks.update({key: {"point": point} for key, point in state["manual"].items()})
    return windows, marks


def fixed_window(point, requested_area, context):
    if context.mpp is None:
        raise HTTPException(422, "Both WSI pixel scales are required to place a calibrated count field.")
    x, y = point
    half_width, half_height = (math.sqrt(requested_area) * 500 / scale for scale in context.mpp)
    bounds = [x - half_width, y - half_height, x + half_width, y + half_height]
    width, height = context.dimensions
    if not (0 <= bounds[0] < bounds[2] <= width and 0 <= bounds[1] < bounds[3] <= height):
        raise HTTPException(422, "Place the entire count field within the scan.")
    return bounds


def apply_change(payload, context, archive, state):
    windows, marks = source_items(archive, state)
    if isinstance(payload, PlaceWindow):
        if len(state["windows"]) >= 100:
            raise HTTPException(422, "This analysis supports up to 100 manual count fields.")
        bounds = fixed_window(payload.point, payload.area, context)
        if bounds in state["windows"].values():
            raise HTTPException(422, "A manual count field is already at this location.")
        key = "manual-" + str(payload.request_key)
        state["windows"][key] = bounds
        return {"window_id": key, "area_mm2": payload.area}
    if isinstance(payload, RemoveWindow):
        if payload.window_id not in state["windows"]:
            raise HTTPException(422, "Select a manual count field.")
        del state["windows"][payload.window_id]
        return {"window_id": payload.window_id}
    bounds = windows.get(payload.window_id)
    if bounds is None:
        raise HTTPException(422, "Select a count field.")
    if isinstance(payload, AddCandidate):
        if not contains(bounds, payload.point):
            raise HTTPException(422, "Mark a point inside the selected count field.")
        if any(tuple(mark["point"]) == payload.point for mark in marks.values()):
            raise HTTPException(422, "A candidate already exists at this location.")
        if len(state["manual"]) >= 2000:
            raise HTTPException(422, "This analysis supports up to 2,000 manual marks.")
        key = "manual-" + str(payload.request_key)
        state["manual"][key] = payload.point
        state["decisions"][key] = "confirmed"
        return {"candidate_id": key, "window_id": payload.window_id, "after": "confirmed"}
    mark = marks.get(payload.candidate_id)
    if mark is None or not contains(bounds, mark["point"]):
        raise HTTPException(422, "The candidate is outside the selected count field.")
    before = state["decisions"].get(payload.candidate_id, "pending")
    if before == payload.status:
        raise HTTPException(422, "Select a different candidate decision.")
    if payload.status == "pending":
        state["decisions"].pop(payload.candidate_id, None)
    else:
        state["decisions"][payload.candidate_id] = payload.status
    return {"candidate_id": payload.candidate_id, "window_id": payload.window_id,
            "before": before, "after": payload.status}


def display(context, source_id, archive, state, references):
    windows, marks = source_items(archive, state)
    candidates = [
        {"id": key, **item, "origin": "manual" if key in state["manual"] else "model",
         "status": state["decisions"].get(key, "pending")} for key, item in marks.items()
    ]
    matched = [ref for ref in references if archive and ref.archive_id == source_id
               and ref.model_version == archive.model.version and ref.checkpoint_sha256 == archive.model.checkpoint_sha256
               and ref.analysis_version == archive.analysis_version and ref.reviewed_at >= archive.analyzed_at]
    fields = []
    for key, bounds in windows.items():
        area = area_mm2(bounds, context.mpp)
        counts = dict.fromkeys(("confirmed", "rejected", "pending"), 0)
        for mark in candidates:
            if contains(bounds, mark["point"]):
                counts[mark["status"]] += 1
        baselines = [ref for ref in matched if ref.window_id == key]
        baseline = baselines[0] if len(baselines) == 1 else None
        comparison = None
        if baseline and area is not None and math.isclose(baseline.area_mm2, area, rel_tol=1e-6):
            comparison = {"reference": baseline.reference, "version": baseline.review_version,
                          "count": baseline.count, "difference": counts["confirmed"] - baseline.count}
        fields.append({"id": key, "bounds": bounds, "manual": key in state["windows"], "area_mm2": area,
                       "counts": counts, "review_density": counts["confirmed"] / area if area else None,
                       "reference": comparison})
    output = archive.model_dump(mode="json", exclude={"binding", "source", "candidates", "windows", "heatmap"}) if archive else {}
    calibrated = bool(archive and scales_match(archive.mpp, context.mpp))
    return {**output, "heatmap_status": "calibration_mismatch" if archive and archive.heatmap and not calibrated
            else "available" if archive and archive.heatmap else "not_reported",
            "heatmap": [tile.model_dump(mode="json") for tile in archive.heatmap] if calibrated else [],
            "windows": fields, "candidates": candidates}


@router.get("")
async def sources(scan_id: UUID, response: Response, user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    _, context = await load_context(scan_id, user, session)
    if context is None:
        return {"status": "stain_unverified", "analyses": [], "manual_id": None, "can_review": False, "mpp": None}
    entries = [{"id": key, "scope": entry.scope, "model": entry.model.model_dump(), "analysis_version": entry.analysis_version}
               for key, entry in context.archives.items()]
    return {"status": "archive_unavailable" if context.archive_failed else "available", "analyses": entries, "manual_id": context.manual_id,
            "can_review": user.role in ANNOTATORS, "mpp": context.mpp}


@router.get("/{source_id}")
async def review(scan_id: UUID, source_id: SourceId, response: Response, user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    _, context = await load_context(scan_id, user, session)
    archive = archive_for(context, source_id)
    base = query_reviews(user, scan_id, source_id, context.binding.case_id)
    current = await session.scalar(base.order_by(Revision.version.desc()).limit(1))
    history = await session.execute(base.with_only_columns(
        Revision.version, Revision.action, Revision.change, Revision.reason, Revision.created_at,
        AuthUser.display_name.label("actor"),
    ).outerjoin(AuthUser, (AuthUser.organization == Revision.organization) & (AuthUser.id.cast(String) == Revision.created_by))
        .order_by(Revision.version.desc()).limit(50))
    references = await asyncio.to_thread(read_references, context.folder) if archive else []
    output = await asyncio.to_thread(display, context, source_id, archive, current.state if current else initial_state(), references)
    return {**output, "version": current.version if current else 0, "history": [dict(row) for row in history.mappings()]}


@router.post("/{source_id}/revisions")
async def save(scan_id: UUID, source_id: SourceId, payload: Change, response: Response,
               user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    if user.role not in ANNOTATORS:
        raise HTTPException(403, "Skin review requires case review permission.")
    path, context = await load_context(scan_id, user, session)
    archive = archive_for(context, source_id)
    case_id = await lock_scan_case(session, user, scan_id)
    binding = await scan_binding(session, user, scan_id, case_id, lock=True)
    scan = await session.scalar(visible_scan(user, scan_id, SlideScan).where(Case.id == case_id).with_for_update(of=SlideScan))
    if binding != context.binding or scan is None or scan.qc_status in BLOCKED_QC:
        raise HTTPException(409, "The registered scan changed. Reopen it before reviewing.")
    verified_path, meta = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    current_key = UUID(scan_fingerprint(meta["storage_key"], meta["size_bytes"], meta["modified_ns"]))
    if verified_path != path or current_key != context.fingerprint:
        raise HTTPException(409, "The registered scan changed. Reopen it before reviewing.")
    base = query_reviews(user, scan_id, source_id, case_id)
    actor = str(user.id)
    request_hash = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    existing = await session.scalar(base.where(Revision.created_by == actor, Revision.request_key == payload.request_key))
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, "This request key has already been used.")
        return {"version": existing.version, "change": existing.change}
    previous = await session.scalar(base.order_by(Revision.version.desc()).limit(1))
    version = previous.version if previous else 0
    if version != payload.expected_version:
        raise HTTPException(409, "The review changed. Reload the latest version.")
    state = json.loads(json.dumps(previous.state)) if previous else initial_state()
    change = apply_change(payload, context, archive, state)
    row = Revision(id=uuid4(), organization=user.organization, case_id=case_id, scan_id=scan_id, source_id=source_id,
                   action=payload.action, state=state, change=change, reason=payload.reason, request_key=payload.request_key,
                   request_hash=request_hash, version=version + 1, created_by=actor)
    session.add(row)
    session.info["user"] = user
    add_event(session, row, "skin_review_" + payload.action, {"version": version},
              {"source": source_id, "scan_id": str(scan_id), "version": row.version, **change},
              reason=payload.reason, case_id=case_id, source="viewer")
    await session.commit()
    return {"version": row.version, "change": change}
