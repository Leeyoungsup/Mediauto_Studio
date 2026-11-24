"""Read-only Quanti PD-L1 snapshots for a verified WSI and institution."""

import asyncio
import hashlib
import json
import os
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from uuid import UUID

import openslide
from fastapi import APIRouter, HTTPException, Path as RoutePath, Query, Response

from app.auth import CurrentUser, Session
from app.pdl1_policy import display_policy
from app.wsi import PRIVATE, Source, registered_path

router = APIRouter(prefix="/api/wsi", tags=["PD-L1"])
BUCKET = 2048
MAX_POINTS = 5000


def result_root():
    return Path(os.environ.get("MEDIAUTO_PDL1_ROOT", Path(__file__).resolve().parents[2] / ".runtime" / "pdl1"))


def slide_signature(path):
    with openslide.OpenSlide(path) as slide:
        quickhash = slide.properties.get("openslide.quickhash-1")
        if not quickhash:
            raise ValueError("WSI quickhash unavailable")
        return {"filename": path.name, "size": path.stat().st_size, "quickhash": quickhash,
                "dimensions": list(slide.dimensions)}


def signature_key(signature):
    return hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()


def snapshot_directory(organization, signature):
    return result_root() / organization / signature_key(signature)


@lru_cache(maxsize=32)
def scan_signature(path, size, modified):
    return slide_signature(path)


@lru_cache(maxsize=8)
def cell_index(path):
    buckets = defaultdict(list)
    with path.open(encoding="utf-8") as stream:
        for x, y, category in json.load(stream):
            buckets[int(x) // BUCKET, int(y) // BUCKET].append((x, y, category))
    return buckets


async def directory_for(source, scan_id, user, session):
    path = await registered_path(source, scan_id, user, session)
    return await snapshot_folder(path, user.organization)


async def snapshot_folder(path, organization):
    def resolve():
        if not (result_root() / organization).is_dir():
            return None
        try:
            stat = path.stat()
            signature = scan_signature(path, stat.st_size, stat.st_mtime_ns)
        except (openslide.OpenSlideError, OSError, ValueError):
            return None
        return snapshot_directory(organization, signature)

    return await asyncio.to_thread(resolve)


def read_summary(path, role):
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as stream:
        summary = json.load(stream)
    return summary if summary["kind"] == "original" or role != "labeler" else None


def summaries(folder, role):
    if folder is None:
        return []
    entries = [read_summary(path, role) for path in folder.glob("*/summary.json")
               if re.fullmatch(r"[a-f0-9]{64}", path.parent.name)]
    return sorted((entry for entry in entries if entry), key=lambda entry: (
        entry["variant"], entry["kind"] != "original", entry["id"],
    ))


def results_for_display(folder, role):
    validation = None
    if folder is not None:
        try:
            validation = json.loads((folder / "comparison-validation.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return display_policy(summaries(folder, role), validation)


@router.get("/{source}/{scan_id}/pdl1")
async def list_results(source: Source, scan_id: UUID, user: CurrentUser, session: Session, response: Response):
    response.headers.update(PRIVATE)
    folder = await directory_for(source, scan_id, user, session)
    return await asyncio.to_thread(results_for_display, folder, user.role)


SnapshotId = Annotated[str, RoutePath(pattern=r"^[a-f0-9]{64}$")]
Coordinate = Annotated[float, Query(ge=0, le=1_000_000_000, allow_inf_nan=False)]


def visible_cells(folder, snapshot_id, role, left, top, right, bottom):
    snapshot = folder / snapshot_id if folder else None
    result = read_summary(snapshot / "summary.json", role) if snapshot else None
    if result is None:
        raise HTTPException(404, "PD-L1 결과를 찾을 수 없습니다.")
    width, height = result["dimensions"]
    right, bottom = min(right, width), min(bottom, height)
    if left >= right or top >= bottom:
        return {"points": [], "truncated": False}
    points = []
    indexed = cell_index(snapshot / "cells.json")
    for (x, y), bucket in indexed.items():
        if (x + 1) * BUCKET <= left or (y + 1) * BUCKET <= top or x * BUCKET >= right or y * BUCKET >= bottom:
            continue
        for cell in bucket:
            if left <= cell[0] < right and top <= cell[1] < bottom:
                if len(points) == MAX_POINTS:
                    return {"points": points, "truncated": True}
                points.append(cell)
    return {"points": points, "truncated": False}


@router.get("/{source}/{scan_id}/pdl1/{snapshot_id}/cells")
async def cells(source: Source, scan_id: UUID, snapshot_id: SnapshotId, user: CurrentUser, session: Session,
                response: Response, left: Coordinate, top: Coordinate, right: Coordinate, bottom: Coordinate):
    response.headers.update(PRIVATE)
    if left >= right or top >= bottom:
        raise HTTPException(422, "표시 영역을 확인하세요.")
    folder = await directory_for(source, scan_id, user, session)
    return await asyncio.to_thread(visible_cells, folder, snapshot_id, user.role, left, top, right, bottom)
