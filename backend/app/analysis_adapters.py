"""Allowlisted local development operations with pinned input and output contracts."""

import re
from dataclasses import dataclass
from threading import Event

from app.pdl1 import results_for_display, snapshot_folder
from app.wsi import read_scan, verified_scan_path
import asyncio


@dataclass(frozen=True)
class Profile:
    name: str
    version: str
    markers: tuple[str, ...]
    checkpoint: str | None = None
    score: str | None = None


PROFILES = {
    "pdl1_cps_archive": Profile("PD-L1 CPS Archive Replay", "archive-v1", ("pdl1",), "PDL1_ST_CPS_detection.pt", "CPS"),
    "pdl1_tps_archive": Profile("PD-L1 TPS Archive Replay", "archive-v1", ("pdl1",), "PDL1_TPS_detection.pt", "TPS"),
    "ihc_preflight": Profile("IHC Image Preflight", "preflight-v1", ("pdl1", "er", "pr", "her2", "ki67")),
}
MARKERS = {"pdl1": "PD-L1", "er": "ER", "pr": "PR", "her2": "HER2", "ki67": "Ki-67"}
SNAPSHOT_FIELDS = ("id", "kind", "score_type", "score_status", "model", "model_version", "analysis_version", "saved_at")


class AnalysisFailure(Exception):
    pass


def marker_for(stain):
    return re.sub(r"[^a-z0-9]", "", (stain or "").lower())


async def execute(organization, model_key, model_version, source, pinned_snapshot, cancelled: Event):
    profile = PROFILES.get(model_key)
    if profile is None or profile.version != model_version:
        raise AnalysisFailure("model_unavailable")
    path, _ = await verified_scan_path(source["storage_key"], (source["size_bytes"], source["modified_ns"]))
    if profile.checkpoint:
        folder = await snapshot_folder(path, organization)
        policy = await asyncio.to_thread(results_for_display, folder, "doctor")
        eligible = [item for item in policy["results"] if item["kind"] == "original"
                    and item["score_type"] == profile.score and item.get("model") == profile.checkpoint
                    and (not pinned_snapshot or item["id"] == pinned_snapshot)]
        if not eligible:
            raise AnalysisFailure("archive_unavailable")
        result = max(eligible, key=lambda item: (item.get("saved_at") or "", item["id"]))
        return {"kind": "archive_replay", "snapshot": {key: result.get(key) for key in SNAPSHOT_FIELDS}}
    metadata = await asyncio.to_thread(read_scan, path, "metadata", cancelled)
    preview = await asyncio.to_thread(read_scan, path, "overview", cancelled, 256)
    if not preview:
        raise AnalysisFailure("scan_unavailable")
    return {"kind": "image_preflight", "dimensions": metadata["dimensions"], "format": metadata["format"],
            "calibrated": bool(metadata["mpp_x"] and metadata["mpp_y"])}
