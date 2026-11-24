"""Validated Level 0 geometry and optional reference records for cutaneous H&E."""

import hashlib
import json
import math
import os
import re
from pathlib import Path
from typing import Annotated, Literal

import openslide
from pydantic import AwareDatetime, Field, model_validator

from app.clinical import ClinicalInput
from app.pdl1 import scan_signature, signature_key
from app.prostate_results import Binding, COORDINATE, DIGEST, IDENTIFIER, MAX_ARCHIVE_BYTES, Model, Region, SlideIdentity, TEXT
from app.wsi import positive_number

SCHEMA = "skin-review-v1"
Point = tuple[COORDINATE, COORDINATE]
Bounds = tuple[COORDINATE, COORDINATE, COORDINATE, COORDINATE]
Capability = Literal["epidermal_orientation", "tissue_regions", "count_fields", "mitosis_candidates", "candidate_heatmap"]
CandidateStatus = Literal["confirmed", "rejected", "pending"]


class Outline(Region):
    kind: Literal["epidermis", "tissue", "lesion"]


class Orientation(ClinicalInput):
    id: IDENTIFIER
    start: Point
    surface: Point


class Window(ClinicalInput):
    id: IDENTIFIER
    bounds: Bounds


class Candidate(ClinicalInput):
    id: IDENTIFIER
    point: Point
    confidence: Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)] | None = None


class Tile(ClinicalInput):
    bounds: Bounds
    density: Annotated[float, Field(strict=True, ge=0, le=1e9, allow_inf_nan=False)]


class Archive(ClinicalInput):
    schema_version: Literal["skin-review-v1"]
    source: SlideIdentity
    binding: Binding
    scope: Literal["cutaneous_histology", "cutaneous_melanoma"]
    stain: Literal["H&E"]
    model: Model
    analysis_version: TEXT
    analyzed_at: AwareDatetime
    capabilities: Annotated[list[Capability], Field(min_length=1, max_length=5)]
    orientation: Annotated[list[Orientation], Field(max_length=100)] = Field(default_factory=list)
    regions: Annotated[list[Outline], Field(max_length=100)] = Field(default_factory=list)
    windows: Annotated[list[Window], Field(max_length=100)] = Field(default_factory=list)
    candidates: Annotated[list[Candidate], Field(max_length=10000)] = Field(default_factory=list)
    heatmap: Annotated[list[Tile], Field(max_length=5000)] = Field(default_factory=list)
    heatmap_unit: Literal["candidates_per_mm2"] | None = None
    mpp: tuple[Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)],
               Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)]] | None = None

    @model_validator(mode="after")
    def validate_geometry_and_scope(self):
        width, height = self.source.dimensions
        capabilities = set(self.capabilities)
        if len(capabilities) != len(self.capabilities):
            raise ValueError("Capabilities must be unique")
        groups = (("epidermal_orientation", self.orientation), ("tissue_regions", self.regions),
                  ("count_fields", self.windows), ("mitosis_candidates", self.candidates),
                  ("candidate_heatmap", self.heatmap))
        for key, items in groups:
            if items and key not in capabilities:
                raise ValueError("Output exceeds the declared model capabilities")
        for items in (self.orientation, self.regions, self.windows, self.candidates):
            if len({item.id for item in items}) != len(items) or any(item.id.startswith("manual-") for item in items):
                raise ValueError("Source IDs must be unique and cannot use the reserved manual prefix")
        for point in ([point for region in self.regions for point in region.points]
                      + [point for row in self.orientation for point in (row.start, row.surface)]):
            if not (0 <= point[0] <= width and 0 <= point[1] <= height):
                raise ValueError("Region or orientation point is outside the scan")
        if any(row.start == row.surface for row in self.orientation):
            raise ValueError("Epidermal direction requires two distinct points")
        if any(not (0 <= row.point[0] < width and 0 <= row.point[1] < height) for row in self.candidates):
            raise ValueError("Candidate is outside the scan")
        for left, top, right, bottom in [row.bounds for row in self.windows] + [tile.bounds for tile in self.heatmap]:
            if not (0 <= left < right <= width and 0 <= top < bottom <= height):
                raise ValueError("Invalid field or tile bounds")
        if self.heatmap and (self.heatmap_unit is None or self.mpp is None):
            raise ValueError("Physical heatmap data requires both pixel scales and candidate density units")
        return self


class Reference(ClinicalInput):
    archive_id: DIGEST
    model_version: TEXT
    checkpoint_sha256: DIGEST
    analysis_version: TEXT
    window_id: IDENTIFIER
    reference: TEXT
    review_version: TEXT
    reviewed_at: AwareDatetime
    area_mm2: Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)]
    count: Annotated[int, Field(strict=True, ge=0, le=10000)]


def folder_for(organization, signature):
    root = Path(os.environ.get("MEDIAUTO_SKIN_ROOT", Path(__file__).resolve().parents[2] / ".runtime" / "skin"))
    return root / organization / signature_key(signature)


def slide_context(path):
    stat = path.stat()
    signature = scan_signature(path, stat.st_size, stat.st_mtime_ns)
    with openslide.OpenSlide(path) as slide:
        mpp_x = positive_number(slide.properties.get("openslide.mpp-x"))
        mpp_y = positive_number(slide.properties.get("openslide.mpp-y"))
    return signature, (mpp_x, mpp_y) if mpp_x and mpp_y else None


def read_archives(folder, binding, signature):
    results = {}
    for item in sorted(folder.glob("*.json")):
        if not re.fullmatch(r"[a-f0-9]{64}", item.stem):
            continue
        if item.stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("Archive exceeds the size limit")
        raw = item.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item.stem:
            raise ValueError("Archive has changed")
        archive = Archive.model_validate_json(raw)
        if archive.source.model_dump(mode="json") == signature and archive.binding == binding:
            results[item.stem] = archive
    return dict(sorted(results.items(), key=lambda pair: pair[1].analyzed_at, reverse=True))


def read_references(folder):
    path = folder / "validation-evidence.json"
    try:
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            return []
        entries = json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return []
    if not isinstance(entries, list):
        return []
    result = []
    for entry in entries:
        try:
            result.append(Reference.model_validate(entry))
        except ValueError:
            continue
    return result


def scales_match(source, actual):
    return source is not None and actual is not None and all(
        math.isclose(x, y, rel_tol=1e-6, abs_tol=0) for x, y in zip(source, actual))


def area_mm2(bounds, mpp):
    left, top, right, bottom = bounds
    return (right - left) * (bottom - top) * mpp[0] * mpp[1] / 1e6 if mpp is not None else None


def contains(bounds, point):
    left, top, right, bottom = bounds
    x, y = point
    return left <= x < right and top <= y < bottom
