"""IMS adapter for the d3741bc Canvas viewer's level-0 coordinate and JPEG tile contract."""

import asyncio
import io
import math
from pathlib import Path
from threading import Event
from typing import Annotated, Literal
from uuid import UUID

import openslide
from fastapi import APIRouter, HTTPException, Query, Request, Response
from PIL import Image, ImageCms
from sqlalchemy import select

from app.auth import CurrentUser, Session
from app.case_activity import record_activity
from app.clinical import ClinicalInput, case_visibility, scan_metadata
from app.intake import DATA_ROOT, INTAKE_PREFIX, require_intake, scan_files, source_id
from app.scan_quality import BLOCKED_QC, embedded_label
from app.models import ApplicationSetting, Case, ScanLabel, Slide, SlideScan, Specimen

TILE_SIZE = 1024
STAGE_DOWNSAMPLES = (1, 4, 8)
PRIVATE = {"Cache-Control": "private, no-store"}
router = APIRouter(prefix="/api/wsi", tags=["WSI"])


def visible_scan(user, scan_id, *columns):
    return (select(*columns).select_from(SlideScan)
            .join(Slide, SlideScan.slide_id == Slide.id)
            .join(Specimen, Slide.specimen_id == Specimen.id)
            .join(Case, Specimen.case_id == Case.id)
            .where(SlideScan.id == scan_id, SlideScan.organization == user.organization,
                   Case.organization == user.organization, case_visibility(Case, user)))


async def registered_file(source, scan_id, user, session) -> tuple[Path, UUID]:
    if source == "files":
        require_intake(user)
        entry = await session.get(ApplicationSetting, INTAKE_PREFIX + str(scan_id))
        if entry is None:
            raise HTTPException(404, "Registered WSI not found.")
        await session.rollback()
        files = await asyncio.to_thread(scan_files, DATA_ROOT)
        match = next((item for item in files if item.id == str(scan_id)), None)
        if match is None:
            raise HTTPException(404, "The scan file was moved or changed.")
        key = match.filename
        expected = None
    else:
        record = (await session.execute(visible_scan(
            user, scan_id, SlideScan.storage_key, SlideScan.size_bytes, SlideScan.modified_ns, SlideScan.qc_status,
        ))).one_or_none()
        if record is None:
            raise HTTPException(404, "Registered WSI not found.")
        key, size, modified, qc = record
        if qc in BLOCKED_QC:
            raise HTTPException(409, "This scan is unavailable for review because of its QC status.")
        expected = (size, modified)
        await session.rollback()
    path, meta = await verified_scan_path(key, expected)
    key = UUID(source_id(meta["storage_key"], meta["size_bytes"], meta["modified_ns"]))
    return path, key


async def verified_scan_path(key, expected):
    meta = await asyncio.to_thread(scan_metadata, key, DATA_ROOT)
    if expected and expected != (meta["size_bytes"], meta["modified_ns"]):
        raise HTTPException(409, "The scan file changed after registration. Check the registration details.")
    return DATA_ROOT.resolve() / meta["storage_key"], meta


async def registered_path(source, scan_id, user, session) -> Path:
    path, _ = await registered_file(source, scan_id, user, session)
    return path


async def lock_scan_case(session, user, scan_id):
    # Share-lock the case so an annotation write cannot cross a concurrent reassignment.
    case = await session.scalar(select(Case.id).join(Specimen, Specimen.case_id == Case.id)
        .join(Slide, Slide.specimen_id == Specimen.id).join(SlideScan, SlideScan.slide_id == Slide.id)
        .where(SlideScan.id == scan_id, Case.organization == user.organization, case_visibility(Case, user))
        .with_for_update(read=True, of=Case))
    if case is None:
        raise HTTPException(404, "Registered WSI not found.")
    return case


def positive_number(value):
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def jpeg(region, output_size):
    # The base renderer composites OpenSlide's transparent padding onto white.
    with region.convert("RGBA") as rgba, Image.new("RGB", region.size, "white") as rgb:
        with rgba.getchannel("A") as alpha:
            rgb.paste(rgba, mask=alpha)
        profile = region.info.get("icc_profile")
        if profile:
            try:
                ImageCms.profileToProfile(rgb, io.BytesIO(profile), ImageCms.createProfile("sRGB"), inPlace=True)
            except (ImageCms.PyCMSError, OSError, ValueError):
                pass
        with rgb.resize(output_size, Image.Resampling.LANCZOS) as output:
            buffer = io.BytesIO()
            output.save(buffer, "JPEG", quality=85)
            return buffer.getvalue()


def read_scan(path, operation, cancelled, coords=None):
    if operation == "label":
        return embedded_label(path)
    with openslide.OpenSlide(path) as slide:
        width, height = slide.dimensions
        if operation == "metadata":
            return {"dimensions": [width, height], "format": path.suffix[1:].upper(),
                    "mpp_x": positive_number(slide.properties.get("openslide.mpp-x")),
                    "mpp_y": positive_number(slide.properties.get("openslide.mpp-y"))}
        if operation == "overview":
            scale = min(1, coords / max(width, height))
            output_size = (max(1, round(width * scale)), max(1, round(height * scale)))
            # Read the pyramid at origin (0, 0). Associated SVS thumbnails can have a different origin.
            level = slide.get_best_level_for_downsample(1 / scale)
            size = slide.level_dimensions[level]
            if math.prod(size) > 16_000_000:
                level = slide.level_count - 1
                size = slide.level_dimensions[level]
            if math.prod(size) > 16_000_000:
                raise HTTPException(422, "This scan has no low-resolution preview available.")
            origin = (0, 0)
        else:
            stage, x, y = coords
            downsample = STAGE_DOWNSAMPLES[stage]
            scene_size = TILE_SIZE * downsample
            origin = (x * scene_size, y * scene_size)
            if origin[0] >= width or origin[1] >= height:
                raise HTTPException(404, "The tile is outside the image.")
            level = slide.get_best_level_for_downsample(downsample)
            size = (round(scene_size / slide.level_downsamples[level]),) * 2
            output_size = (TILE_SIZE, TILE_SIZE)
        if cancelled.is_set():
            return None
        with slide.read_region(origin, level, size) as region:
            return None if cancelled.is_set() else jpeg(region, output_size)


async def scan_response(request, path, operation, coords=None):
    cancelled = Event()

    async def render():
        async with request.app.state.wsi_slots:
            if not cancelled.is_set():
                return await asyncio.to_thread(read_scan, path, operation, cancelled, coords)
        return None

    job = asyncio.create_task(render())
    try:
        while not job.done():
            await asyncio.wait((job,), timeout=0.15)
            if not job.done() and await request.is_disconnected():
                raise HTTPException(499, "The slide request was canceled.")
        data = job.result()
    except (openslide.OpenSlideError, OSError, ValueError) as exc:
        raise HTTPException(422, "Unable to read the scan. Check the file format and condition.") from exc
    finally:
        cancelled.set()
        if not job.done():
            # The native read can finish independently. The slot remains occupied until it returns.
            job.add_done_callback(lambda task: None if task.cancelled() else task.exception())
    if operation == "metadata":
        return data
    return Response(data, media_type="image/jpeg", headers=PRIVATE)


Source = Literal["clinical", "files"]


@router.get("/{source}/{scan_id}")
async def metadata(source: Source, scan_id: UUID, request: Request, user: CurrentUser, session: Session):
    path = await registered_path(source, scan_id, user, session)
    return await scan_response(request, path, "metadata")


class ScanViewEvent(ClinicalInput):
    attempt_id: UUID
    result: Literal["success", "failed"]


@router.post("/clinical/{scan_id}/view-events", status_code=204)
async def scan_view_event(scan_id: UUID, data: ScanViewEvent, user: CurrentUser, session: Session):
    async with session.begin():
        row = (await session.execute(visible_scan(user, scan_id, Case.id, SlideScan.qc_status)
                                    .with_for_update(read=True, of=Case))).one_or_none()
        if row is None or (data.result == "success" and row.qc_status in BLOCKED_QC):
            raise HTTPException(404, "Registered WSI not found.")
        await record_activity(session, user, row.id, "scan_viewed", "scan", scan_id, data.attempt_id, data.result)


@router.get("/{source}/{scan_id}/overview.jpeg")
async def overview(source: Source, scan_id: UUID, request: Request, user: CurrentUser, session: Session,
                   size: Annotated[int, Query(ge=64, le=960)] = 960):
    path = await registered_path(source, scan_id, user, session)
    return await scan_response(request, path, "overview", size)


@router.get("/{source}/{scan_id}/label.jpeg")
async def label(source: Source, scan_id: UUID, request: Request, user: CurrentUser, session: Session):
    path = await registered_path(source, scan_id, user, session)
    if source == "clinical":
        scan = (await session.execute(
            visible_scan(user, scan_id, SlideScan.qc_status, ScanLabel.jpeg)
            .outerjoin(ScanLabel, (ScanLabel.organization == SlideScan.organization) & (ScanLabel.scan_id == SlideScan.id))
            .order_by(ScanLabel.version.desc()).limit(1)
        )).one_or_none()
        await session.rollback()
        if scan is None:
            raise HTTPException(404, "Registered WSI not found.")
        if scan.qc_status in BLOCKED_QC:
            raise HTTPException(409, "This scan is unavailable for review because of its QC status.")
        if scan.jpeg is not None:
            return Response(scan.jpeg, media_type="image/jpeg", headers={**PRIVATE, "X-Label-Source": "uploaded"})
    response = await scan_response(request, path, "label")
    response.headers["X-Label-Source"] = "embedded"
    return response


@router.get("/{source}/{scan_id}/{stage}/{x}/{y}.jpeg")
async def tile(source: Source, scan_id: UUID, stage: int, x: int, y: int,
               request: Request, user: CurrentUser, session: Session):
    if not 0 <= stage < len(STAGE_DOWNSAMPLES) or min(x, y) < 0:
        raise HTTPException(400, "Check the tile coordinates.")
    path = await registered_path(source, scan_id, user, session)
    return await scan_response(request, path, "tile", (stage, x, y))
