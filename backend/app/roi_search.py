"""Case-scoped ROI similarity search and explicit local reference enrollment."""

import asyncio
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from app.auth import CurrentUser, Session, require_roles
from app.case_activity import attempt_id, record_activity
from app.clinical import ClinicalInput
from app.intake import source_id
from app.models import ApplicationSetting, Case, Slide, SlideScan, Specimen, ViewerAnnotation
from app.roi_search_adapter import ADAPTER, ORGAN_SYSTEMS, OrganSystem, SearchReference
from app.scan_quality import BLOCKED_QC
from app.viewer_records import ANNOTATORS
from app.wsi import PRIVATE, registered_file, scan_response, verified_scan_path, visible_scan

router = APIRouter(prefix="/api/wsi/clinical/{scan_id}/roi-search/rois/{annotation_id}", tags=["ROI similarity search"])
AREA_KINDS = ("rectangle", "ellipse", "polygon")
MAX_REFERENCES = 64
RESULT_LIMIT = 8


class SearchInput(ClinicalInput):
    organ_system: OrganSystem


@dataclass(frozen=True)
class Area:
    case_id: UUID
    fingerprint: UUID
    kind: str
    points: list


def catalog_key(case_id):
    return f"roi_search_references:{case_id}"


async def catalog(session, case_id):
    record = await session.get(ApplicationSetting, catalog_key(case_id))
    return record.value if record else {}


def selectable_roi(user, annotation_id, fingerprint):
    return (
        ViewerAnnotation.organization == user.organization, ViewerAnnotation.id == annotation_id,
        ViewerAnnotation.scan_key == fingerprint, ViewerAnnotation.deleted_at.is_(None),
        ViewerAnnotation.kind.in_(AREA_KINDS),
    )


async def scoped_roi(scan_id, annotation_id, user, session):
    require_roles(user, ANNOTATORS)
    path, fingerprint = await registered_file("clinical", scan_id, user, session)
    case_id = await session.scalar(visible_scan(user, scan_id, Case.id))
    row = (await session.execute(select(ViewerAnnotation.kind, ViewerAnnotation.points)
                                 .where(*selectable_roi(user, annotation_id, fingerprint)))).one_or_none()
    if case_id is None or row is None:
        raise HTTPException(404, "A saved area ROI was not found for this scan.")
    return path, Area(case_id, fingerprint, row.kind, row.points)


async def crop(request, path, area):
    return await scan_response(request, path, "capture", (area.kind, area.points, False, False, 256))


async def confirm_scope(session, user, scan_id, area, annotation_id, exclusive=False):
    scan = (await session.execute(visible_scan(user, scan_id, Case.id, SlideScan.storage_key,
        SlideScan.size_bytes, SlideScan.modified_ns).where(SlideScan.qc_status.not_in(BLOCKED_QC))
        .with_for_update(of=Case, read=not exclusive))).one_or_none()
    if scan is None or scan.id != area.case_id or source_id(scan.storage_key, scan.size_bytes, scan.modified_ns) != str(area.fingerprint):
        raise HTTPException(409, "The source scan changed or is unavailable. Open the ROI again.")
    live_roi = await session.scalar(select(ViewerAnnotation.id).where(*selectable_roi(user, annotation_id, area.fingerprint)))
    if live_roi is None:
        raise HTTPException(404, "The ROI is no longer available.")


async def audit(session, user, area, annotation_id, request, action):
    await record_activity(session, user, area.case_id, action, "roi_similarity", annotation_id, attempt_id(request))


@router.get("")
async def roi_search_context(scan_id: UUID, annotation_id: UUID, user: CurrentUser, session: Session, response: Response):
    _, area = await scoped_roi(scan_id, annotation_id, user, session)
    reference = (await catalog(session, area.case_id)).get(str(annotation_id))
    response.headers.update(PRIVATE)
    return {"case_id": area.case_id, "adapter": ADAPTER.name, "organ_systems": ORGAN_SYSTEMS,
            "organ_system": reference["organ_system"] if reference and reference["scan_id"] == str(scan_id) else None}


@router.get("/preview.png")
async def roi_search_preview(scan_id: UUID, annotation_id: UUID, request: Request, user: CurrentUser, session: Session):
    path, area = await scoped_roi(scan_id, annotation_id, user, session)
    await session.rollback()
    preview = await crop(request, path, area)
    async with session.begin():
        await confirm_scope(session, user, scan_id, area, annotation_id)
    return preview


@router.put("/reference")
async def index_roi_reference(scan_id: UUID, annotation_id: UUID, data: SearchInput,
                              request: Request, user: CurrentUser, session: Session):
    path, area = await scoped_roi(scan_id, annotation_id, user, session)
    await session.rollback()
    image = await crop(request, path, area)
    try:
        signature = await asyncio.to_thread(ADAPTER.describe, image.body)
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "The ROI search adapter is temporarily unavailable. Try again.") from exc
    entry = {"scan_id": str(scan_id), "organ_system": data.organ_system, "signature": signature, "adapter": ADAPTER.name}
    async with session.begin():
        # Exclusive case lock serializes local reference edits, including first-time enrollment.
        await confirm_scope(session, user, scan_id, area, annotation_id, exclusive=True)
        existing = await catalog(session, area.case_id)
        if str(annotation_id) not in existing and len(existing) >= MAX_REFERENCES:
            retained = await reference_scans(session, user, area.case_id, {UUID(token): value for token, value in existing.items()})
            existing = {token: item for token, item in existing.items() if UUID(token) in retained}
            if len(existing) >= MAX_REFERENCES:
                raise HTTPException(409, "This case holds 64 local references. Remove an existing reference first.")
        await session.merge(ApplicationSetting(key=catalog_key(area.case_id), value={**existing, str(annotation_id): entry}))
        await audit(session, user, area, annotation_id, request, "roi_reference_saved")
    return {"organ_system": data.organ_system}


@router.delete("/reference")
async def remove_roi_reference(scan_id: UUID, annotation_id: UUID, request: Request, user: CurrentUser, session: Session):
    _, area = await scoped_roi(scan_id, annotation_id, user, session)
    await session.rollback()
    async with session.begin():
        await confirm_scope(session, user, scan_id, area, annotation_id, exclusive=True)
        existing = await catalog(session, area.case_id)
        entry = existing.get(str(annotation_id))
        if entry and entry["scan_id"] == str(scan_id):
            await session.merge(ApplicationSetting(key=catalog_key(area.case_id),
                value={token: value for token, value in existing.items() if token != str(annotation_id)}))
            await audit(session, user, area, annotation_id, request, "roi_reference_removed")
    return {"organ_system": None}


async def reference_scans(session, user, case_id, entries):
    if not entries:
        return {}
    scans = (await session.execute(select(SlideScan.id, SlideScan.storage_key,
        SlideScan.size_bytes, SlideScan.modified_ns, SlideScan.format, Slide.slide_number)
        .join(Slide, (Slide.id == SlideScan.slide_id) & (Slide.organization == SlideScan.organization))
        .join(Specimen, (Specimen.id == Slide.specimen_id) & (Specimen.organization == SlideScan.organization))
        .where(SlideScan.organization == user.organization, Specimen.case_id == case_id,
               SlideScan.id.in_({UUID(item["scan_id"]) for item in entries.values()}), SlideScan.qc_status.not_in(BLOCKED_QC),
    ))).all()
    by_scan = {str(scan.id): scan for scan in scans}
    rois = (await session.execute(select(ViewerAnnotation.id, ViewerAnnotation.scan_key).where(
        ViewerAnnotation.organization == user.organization, ViewerAnnotation.id.in_(entries),
        ViewerAnnotation.deleted_at.is_(None), ViewerAnnotation.kind.in_(AREA_KINDS),
    ))).all()
    locations = {}
    for roi_id, fingerprint in rois:
        scan = by_scan.get(entries[roi_id]["scan_id"])
        if scan is not None and str(fingerprint) == source_id(scan.storage_key, scan.size_bytes, scan.modified_ns):
            locations[roi_id] = scan
    return locations


async def active_entries(session, area, annotation_id, organ_system):
    return {UUID(token): item for token, item in (await catalog(session, area.case_id)).items()
            if token != str(annotation_id) and item["organ_system"] == organ_system and item["adapter"] == ADAPTER.name}


@router.post("/search")
async def search_roi(scan_id: UUID, annotation_id: UUID, data: SearchInput,
                     request: Request, user: CurrentUser, session: Session, response: Response):
    path, area = await scoped_roi(scan_id, annotation_id, user, session)
    entries = await active_entries(session, area, annotation_id, data.organ_system)
    locations = await reference_scans(session, user, area.case_id, entries)
    tokens = dict(enumerate(sorted(locations)))
    references = [SearchReference(token, tuple(entries[roi_id]["signature"])) for token, roi_id in tokens.items()]
    await session.rollback()
    verified = []
    if references:
        image = await crop(request, path, area)
        try:
            ranked = await asyncio.to_thread(ADAPTER.search, image.body, data.organ_system, references, len(references))
        except (OSError, ValueError) as exc:
            raise HTTPException(503, "The ROI search adapter is temporarily unavailable. Try again.") from exc
        for token in dict.fromkeys(ranked):
            roi_id = tokens.get(token)
            scan = locations.get(roi_id)
            if scan is None:
                continue
            try:
                await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
            except HTTPException:
                continue
            verified.append(roi_id)
    async with session.begin():
        await confirm_scope(session, user, scan_id, area, annotation_id)
        latest = await active_entries(session, area, annotation_id, data.organ_system) if verified else {}
        allowed = await reference_scans(session, user, area.case_id,
                                        {roi_id: latest[roi_id] for roi_id in verified if roi_id in latest})
        matches = [{"scan_id": allowed[roi_id].id, "roi_id": roi_id, "slide": allowed[roi_id].slide_number,
                    "format": allowed[roi_id].format} for roi_id in verified if roi_id in allowed][:RESULT_LIMIT]
        await audit(session, user, area, annotation_id, request, "roi_search_run")
    response.headers.update(PRIVATE)
    return {"organ_system": data.organ_system, "results": matches}
