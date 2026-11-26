"""Personal tissue registration profiles for a verified set of case scans."""

import asyncio
import hashlib
import math
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from pydantic import Field, StringConstraints
from sqlalchemy import select

from app.auth import CurrentUser, Session
from app.clinical import ClinicalInput, case_visibility
from app.intake import DATA_ROOT, require_intake, save_version, scan_files, slide_entries, source_id
from app.models import ApplicationSetting, Case, Slide, SlideScan, Specimen
from app.scan_quality import BLOCKED_QC
from app.viewer_records import Coordinate, check_point
from app.wsi import PRIVATE, scan_response, verified_scan_path

router = APIRouter(prefix="/api/viewer", tags=["Tissue registration"])

Tissue = Annotated[str, StringConstraints(pattern=r"^[A-Z]$")]
Scans = Annotated[list[UUID], Field(min_length=2, max_length=6)]
Scope = Literal["cases", "file-cases"]
CaseKey = Annotated[str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")]
catalog_path = "/{scope}/{case_key}/tissue-registrations"


def case_scope(scope: Scope, case_key: str) -> UUID | str:
    if scope == "file-cases":
        return case_key
    try:
        return UUID(case_key)
    except ValueError:
        raise HTTPException(422, "Choose a valid case ID.") from None


class TissueLandmarks(ClinicalInput):
    reference: UUID
    points: Annotated[dict[UUID, Annotated[list[tuple[Coordinate, Coordinate]], Field(min_length=3, max_length=8)]],
                      Field(min_length=2, max_length=6)]


class AlignmentPosition(ClinicalInput):
    x: Coordinate
    y: Coordinate
    zoom: Annotated[float, Field(gt=0, le=64, allow_inf_nan=False)]


class TissueUpdate(ClinicalInput):
    scan_ids: Scans
    version: Annotated[int, Field(ge=0)]
    active: Tissue | None
    sync: bool = False
    landmarks: TissueLandmarks | None = None
    anchors: Annotated[dict[UUID, AlignmentPosition], Field(min_length=2, max_length=6)] | None = None


def storage_prefix(case_id, user):
    case_fingerprint = (case_id.hex if isinstance(case_id, UUID)
                        else hashlib.sha256(f"files:{case_id}".encode()).hexdigest()[:32])
    return f"tissue:{case_fingerprint}:{user.id.hex}:"


def storage_key(case_id, user, scan_ids):
    if len(set(scan_ids)) != len(scan_ids):
        raise HTTPException(422, "Choose different scans for tissue registration.")
    digest = hashlib.sha256(",".join(sorted(map(str, scan_ids))).encode()).hexdigest()[:20]
    return storage_prefix(case_id, user) + digest


async def file_scan_bindings(session, user, case_number, scan_ids, *, lock):
    require_intake(user)
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    selected_ids = set(map(str, scan_ids))
    selected = [source for source in sources if source.id in selected_ids]
    entries = await slide_entries(session, selected, lock=lock)
    if len(entries) != len(scan_ids) or any(entry["fields"]["case_id"] != case_number for entry in entries.values()):
        raise HTTPException(404, "A registration scan is unavailable in this case.")

    def verify():
        bindings = {}
        for source in selected:
            try:
                stat = (DATA_ROOT / source.filename).stat()
            except OSError:
                raise HTTPException(404, "A registration scan is unavailable in this case.") from None
            binding = (source.filename, stat.st_size, stat.st_mtime_ns)
            if source_id(*binding) != source.id:
                raise HTTPException(409, "A registration scan changed. Reload the comparison.")
            bindings[UUID(source.id)] = binding
        return bindings

    return await asyncio.to_thread(verify)


async def scan_bindings(session, user, case_id, scan_ids, *, lock=False):
    if isinstance(case_id, str):
        return await file_scan_bindings(session, user, case_id, scan_ids, lock=lock)
    query = (select(SlideScan.id, SlideScan.storage_key, SlideScan.size_bytes, SlideScan.modified_ns)
             .join(Slide, Slide.id == SlideScan.slide_id)
             .join(Specimen, Specimen.id == Slide.specimen_id)
             .join(Case, Case.id == Specimen.case_id)
             .where(Case.id == case_id, Case.organization == user.organization, case_visibility(Case, user),
                    SlideScan.organization == user.organization, SlideScan.id.in_(scan_ids), SlideScan.qc_status.not_in(BLOCKED_QC)))
    if lock:
        query = query.with_for_update(read=True, of=(Case, SlideScan))
    rows = (await session.execute(query)).all()
    if len(rows) != len(scan_ids):
        raise HTTPException(404, "A registration scan is unavailable in this case.")
    return {scan: (key, size, modified) for scan, key, size, modified in rows}


async def saved_catalog(session, key, signatures):
    stored = await session.get(ApplicationSetting, key)
    entry = stored.value if stored else {}
    profiles = entry["profiles"] if entry.get("signatures") == signatures else {}
    active = entry.get("active") if entry.get("active") in profiles else None
    return {"version": entry.get("version", 0), "profiles": profiles,
            "active": active, "sync": bool(active and entry.get("sync"))}


async def inherited_catalog(session, prefix, signatures):
    # The selected scan fingerprints must still match the broader registration.
    records = await session.scalars(select(ApplicationSetting.value).where(ApplicationSetting.key.startswith(prefix)))
    candidates = []
    for entry in records:
        saved = entry.get("signatures", {})
        active = entry.get("active")
        profile = entry.get("profiles", {}).get(active)
        if profile and len(saved) > len(signatures) and all(saved.get(scan) == signature for scan, signature in signatures.items()):
            candidates.append((len(saved), profile["saved_at"], active, profile, bool(entry.get("sync"))))
    if not candidates:
        return None
    smallest = min(candidate[0] for candidate in candidates)
    _, _, active, profile, sync = max((candidate for candidate in candidates if candidate[0] == smallest),
                                      key=lambda candidate: candidate[1])
    if "anchors" in profile:
        selected_profile = {**profile, "anchors": {scan: profile["anchors"][scan] for scan in signatures}}
    else:
        # The two fitting landmarks define the same relative transforms from any selected reference.
        reference = profile["reference"] if profile["reference"] in signatures else min(signatures)
        selected_profile = {**profile, "reference": reference, "points": {scan: profile["points"][scan] for scan in signatures}}
    return {"version": 0, "profiles": {active: selected_profile}, "active": active, "sync": sync, "inherited": True}


def fingerprints(bindings):
    return {str(scan): source_id(*binding) for scan, binding in bindings.items()}


@router.get(catalog_path)
async def get_registrations(scope: Scope, case_key: CaseKey, user: CurrentUser, session: Session, response: Response,
                            scan_ids: Annotated[list[UUID], Query(min_length=2, max_length=6)]):
    response.headers.update(PRIVATE)
    case_id = case_scope(scope, case_key)
    key = storage_key(case_id, user, scan_ids)
    bindings = await scan_bindings(session, user, case_id, scan_ids)
    signatures = fingerprints(bindings)
    catalog = await saved_catalog(session, key, signatures)
    if catalog["version"] == 0:
        inherited = await inherited_catalog(session, storage_prefix(case_id, user), signatures)
        if inherited:
            return inherited
    return catalog


@router.put(catalog_path)
async def save_registration(scope: Scope, case_key: CaseKey, data: TissueUpdate, request: Request, response: Response,
                            user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    case_id = case_scope(scope, case_key)
    key = storage_key(case_id, user, data.scan_ids)
    if data.anchors and data.landmarks:
        raise HTTPException(422, "Choose one tissue alignment method.")
    if data.active is None and (data.sync or data.landmarks or data.anchors):
        raise HTTPException(422, "Choose a tissue for registration.")
    bindings = None
    if data.anchors or data.landmarks:
        points = ({scan: [(camera.x, camera.y)] for scan, camera in data.anchors.items()}
                  if data.anchors else data.landmarks.points)
        if set(points) != set(data.scan_ids) or (data.landmarks and data.landmarks.reference not in points):
            raise HTTPException(422, "Set corresponding alignment positions for the selected scans.")
        if len({len(group) for group in points.values()}) != 1:
            raise HTTPException(422, "Pick the same number of landmarks for each scan.")
        bindings = await scan_bindings(session, user, case_id, data.scan_ids)
        await session.rollback()
        for scan_id, (storage, size, modified) in bindings.items():
            group = points[scan_id]
            if data.landmarks and math.dist(group[0], group[1]) < 4:
                raise HTTPException(422, "Choose two more widely spaced fit landmarks.")
            path, _ = await verified_scan_path(storage, (size, modified))
            metadata = await scan_response(request, path, "metadata")
            for x, y in group:
                check_point(x, y, metadata["dimensions"])
    async with session.begin():
        current = await scan_bindings(session, user, case_id, data.scan_ids, lock=True)
        if bindings is not None and bindings != current:
            raise HTTPException(409, "The selected scans changed. Reload the comparison.")
        signatures = fingerprints(current)
        catalog = await saved_catalog(session, key, signatures)
        if data.version != catalog["version"]:
            raise HTTPException(409, "Tissue registrations changed in another session. Reload saved tissues.")
        profiles = {**catalog["profiles"]}
        if data.landmarks or data.anchors:
            alignment = ({"anchors": data.model_dump(mode="json")["anchors"]} if data.anchors
                         else data.landmarks.model_dump(mode="json"))
            profiles[data.active] = {**alignment, "saved_at": datetime.now(timezone.utc).isoformat()}
        if data.active is not None and data.active not in profiles:
            raise HTTPException(404, "Saved tissue registration not found.")
        result = {"version": data.version + 1, "profiles": profiles, "active": data.active, "sync": data.sync}
        await save_version(session, key, data.version, {**result, "signatures": signatures})
        return result
