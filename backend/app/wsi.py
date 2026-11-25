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
from PIL import Image, ImageCms, ImageDraw
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


def apply_color_profile(rgb, profile):
    if profile:
        try:
            ImageCms.profileToProfile(rgb, io.BytesIO(profile), ImageCms.createProfile("sRGB"), inPlace=True)
        except (ImageCms.PyCMSError, OSError, ValueError):
            pass


def resized_region(region, output_size):
    # The base renderer composites OpenSlide's transparent padding onto white.
    with region.convert("RGBA") as rgba, Image.new("RGB", region.size, "white") as rgb:
        with rgba.getchannel("A") as alpha:
            rgb.paste(rgba, mask=alpha)
        apply_color_profile(rgb, region.info.get("icc_profile"))
        return rgb.resize(output_size, Image.Resampling.LANCZOS)


def encode_jpeg(image):
    with io.BytesIO() as buffer:
        image.save(buffer, "JPEG", quality=85)
        return buffer.getvalue()


def full_scene_overview(slide, level, output_size, cancelled):
    width, height = slide.level_dimensions[level]
    if width * height > 64_000_000:
        raise HTTPException(422, "This scan has no low-resolution preview available.")
    downsample = slide.level_downsamples[level]
    out_width, out_height = output_size
    strip_height = max(1, 4_000_000 // width)
    with Image.new("RGB", output_size, "white") as preview:
        for top in range(0, height, strip_height):
            if cancelled.is_set():
                return None
            bottom = min(top + strip_height, height)
            output_top, output_bottom = round(top * out_height / height), round(bottom * out_height / height)
            if output_bottom == output_top:
                continue
            origin = (0, round(top * downsample))
            with slide.read_region(origin, level, (width, bottom - top)) as strip:
                with resized_region(strip, (out_width, output_bottom - output_top)) as resized:
                    preview.paste(resized, (0, output_top))
        return None if cancelled.is_set() else encode_jpeg(preview)


def capture_roi(slide, cancelled, kind, points, include_annotation, include_scale, max_edge=1600):
    xs, ys = zip(*points)
    left, top = math.floor(min(xs)), math.floor(min(ys))
    width, height = max(1, math.ceil(max(xs)) - left), max(1, math.ceil(max(ys)) - top)
    scale = min(1, max_edge / max(width, height))
    output = (max(1, round(width * scale)), max(1, round(height * scale)))
    level = slide.get_best_level_for_downsample(1 / scale)
    level_scale = slide.level_downsamples[level]
    size = (math.ceil(width / level_scale), math.ceil(height / level_scale))
    if math.prod(size) > 16_000_000:
        raise HTTPException(422, "This ROI needs a lower resolution pyramid level. Select a smaller region.")
    if cancelled.is_set():
        return None
    with slide.read_region((left, top), level, size) as region:
        if cancelled.is_set():
            return None
        # Clip the rounding padding before rendering so geometry uses the exact level-0 region.
        crop = (0, 0, width / level_scale, height / level_scale)
        with region.resize(output, Image.Resampling.LANCZOS, box=crop) as scaled, Image.new("RGB", output, "white") as image:
            with scaled.getchannel("A") as alpha:
                image.paste(scaled, mask=alpha)
            apply_color_profile(image, region.info.get("icc_profile"))
            draw = ImageDraw.Draw(image)
            sx, sy = output[0] / width, output[1] / height
            projected = [(min(output[0] - 1, (x - left) * sx), min(output[1] - 1, (y - top) * sy)) for x, y in points]
            if include_annotation:
                if kind in ("rectangle", "ellipse"):
                    box = (min(x for x, _ in projected), min(y for _, y in projected),
                           max(x for x, _ in projected), max(y for _, y in projected))
                    shape = draw.rectangle if kind == "rectangle" else draw.ellipse
                    shape(box, outline="#e66335", width=2)
                else:
                    draw.line(projected + ([projected[0]] if kind == "polygon" else []),
                              fill="#e66335", width=2, joint="curve")
            if include_scale:
                mpp = positive_number(slide.properties.get("openslide.mpp-x"))
                if not mpp:
                    raise HTTPException(422, "The scan has no calibrated horizontal pixel size for a scale bar.")
                if output[0] < 90 or output[1] < 28:
                    raise HTTPException(422, "Select a larger ROI to include the scale bar.")
                approximate = min(130, output[0] - 22) * mpp / sx
                decade = 10 ** math.floor(math.log10(approximate))
                microns = max(step * decade for step in (1, 2, 5) if step * decade <= approximate)
                bar = round(microns * sx / mpp)
                caption = f"{microns / 1000:g} mm" if microns >= 1000 else f"{microns:g} µm"
                y = output[1] - 8
                draw.rectangle((4, y - 17, min(output[0] - 1, max(80, 16 + bar)), y + 4), fill="white")
                draw.line((9, y, 9 + bar, y), fill="black", width=2)
                draw.text((9, y - 15), caption, fill="black")
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()


def read_scan(path, operation, cancelled, coords=None):
    if operation == "label":
        return embedded_label(path)
    with openslide.OpenSlide(path) as slide:
        width, height = slide.dimensions
        if operation == "capture":
            return capture_roi(slide, cancelled, *coords)
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
                return full_scene_overview(slide, level, output_size, cancelled)
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
            if cancelled.is_set():
                return None
            with resized_region(region, output_size) as resized:
                return encode_jpeg(resized)


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
    return Response(data, media_type="image/png" if operation == "capture" else "image/jpeg", headers=PRIVATE)


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
