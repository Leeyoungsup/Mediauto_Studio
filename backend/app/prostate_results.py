"""Versioned prostate needle-biopsy output bound to a clinical scan."""

import asyncio
import hashlib
import json
import math
import os
import re
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import openslide
from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from app.auth import CurrentUser, Session
from app.clinical import ClinicalInput
from app.models import Case, Slide, Specimen
from app.pdl1 import scan_signature, signature_key
from app.wsi import PRIVATE, registered_path, visible_scan

router = APIRouter(prefix="/api/wsi/clinical", tags=["Prostate AI"])
SCHEMA = "prostate-core-level-v1"
MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
IDENTIFIER = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")]
TEXT = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
DIGEST = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
COORDINATE = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
RegionKind = Literal["tissue", "tumor", "pni"]
Capability = Literal["tissue_region", "tumor_region", "pni_region", "core_length", "tumor_length", "grade_group", "pni"]
OUTPUTS = ("core_length", "tumor_length", "grade_group", "pni")
REGIONS = ("tissue_region", "tumor_region", "pni_region")


class Binding(ClinicalInput):
    case_id: UUID
    specimen_id: UUID
    slide_id: UUID
    block_id: UUID | None


class InputScope(ClinicalInput):
    organ: Literal["prostate"]
    specimen_type: Literal["needle_biopsy"]
    stain: Literal["H&E"]
    protocol: TEXT


class Model(ClinicalInput):
    name: TEXT
    version: TEXT
    checkpoint_sha256: DIGEST


class Length(ClinicalInput):
    value: Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
    unit: Literal["mm", "um"]
    method: Literal["single_focus", "continuous_span", "sum_of_foci", "core_axis"]

    @property
    def mm(self):
        return self.value if self.unit == "mm" else self.value / 1000


class Region(ClinicalInput):
    id: IDENTIFIER
    kind: RegionKind
    points: Annotated[list[tuple[COORDINATE, COORDINATE]], Field(min_length=3, max_length=256)]

    @model_validator(mode="after")
    def check_polygon(self):
        pairs = zip(self.points, self.points[1:] + self.points[:1])
        x0, y0 = self.points[0]
        area = sum((x - x0) * (ny - y0) - (y - y0) * (nx - x0) for (x, y), (nx, ny) in pairs)
        if len(set(self.points)) != len(self.points) or area == 0:
            raise ValueError("A region needs a non-degenerate polygon with distinct vertices")
        return self


class Findings(ClinicalInput):
    core_length: Length | None = None
    tumor_length: Length | None = None
    grade_group: Annotated[int, Field(strict=True, ge=1, le=5)] | None = None
    pni: Literal["present", "not_identified", "indeterminate"] | None = None

    @model_validator(mode="after")
    def check_methods(self):
        if self.core_length and self.core_length.method != "core_axis":
            raise ValueError("Core length requires the source's core-axis measurement")
        if self.tumor_length and self.tumor_length.method == "core_axis":
            raise ValueError("Tumor length requires a tumor measurement method")
        return self


class CoreLevel(ClinicalInput):
    core_id: IDENTIFIER
    level_id: IDENTIFIER
    regions: Annotated[list[Region], Field(max_length=100)] = Field(default_factory=list)
    findings: Findings = Field(default_factory=Findings)

    @model_validator(mode="after")
    def unique_regions(self):
        if len({region.id for region in self.regions}) != len(self.regions):
            raise ValueError("Region IDs must be unique within each core and level")
        return self


class SlideIdentity(ClinicalInput):
    filename: TEXT
    size: Annotated[int, Field(strict=True, gt=0)]
    quickhash: DIGEST
    dimensions: tuple[Annotated[int, Field(strict=True, gt=0)], Annotated[int, Field(strict=True, gt=0)]]


class Archive(ClinicalInput):
    schema_version: Literal["prostate-core-level-v1"]
    source: SlideIdentity
    binding: Binding
    input: InputScope
    model: Model
    analysis_version: TEXT
    analyzed_at: AwareDatetime
    capabilities: Annotated[list[Capability], Field(min_length=1, max_length=7)]
    core_levels: Annotated[list[CoreLevel], Field(min_length=1, max_length=200)]

    @model_validator(mode="after")
    def verify_output_contract(self):
        width, height = self.source.dimensions
        keys = {(row.core_id, row.level_id) for row in self.core_levels}
        capabilities = set(self.capabilities)
        if len(keys) != len(self.core_levels) or len(capabilities) != len(self.capabilities):
            raise ValueError("Duplicate core/level pair or capability")
        if sum(len(region.points) for row in self.core_levels for region in row.regions) > 25000:
            raise ValueError("The archive exceeds the total region point limit")
        for row in self.core_levels:
            for key in OUTPUTS:
                if getattr(row.findings, key) is not None and key not in capabilities:
                    raise ValueError("Finding is outside the model's declared output capabilities")
            for region in row.regions:
                if region.kind + "_region" not in capabilities:
                    raise ValueError("Region type is outside the model's declared output capabilities")
                if any(x > width or y > height for x, y in region.points):
                    raise ValueError("Region vertex is outside the Level 0 scan")
        return self


class Reference(ClinicalInput):
    archive_id: DIGEST
    checkpoint_sha256: DIGEST
    model_version: TEXT
    analysis_version: TEXT
    core_id: IDENTIFIER
    level_id: IDENTIFIER
    reference: TEXT
    review_version: TEXT
    reviewed_by: TEXT
    reviewed_at: AwareDatetime
    findings: Findings


def result_root(organization, signature):
    root = Path(os.environ.get("MEDIAUTO_PROSTATE_ROOT", Path(__file__).resolve().parents[2] / ".runtime" / "prostate"))
    return root / organization / signature_key(signature)


def registry(path):
    try:
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            return []
        records = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(records, list):
        return []
    validated = []
    for record in records:
        try:
            validated.append(Reference.model_validate(record))
        except ValueError:
            continue
    return validated


def same_finding(value, baseline):
    if isinstance(value, Length):
        return value.method == baseline.method and math.isclose(value.mm, baseline.mm, abs_tol=1e-9, rel_tol=0)
    return value == baseline


def display_archive(archive_id, archive, references):
    matching_version = [ref for ref in references if ref.archive_id == archive_id
                        and ref.checkpoint_sha256 == archive.model.checkpoint_sha256
                        and ref.model_version == archive.model.version and ref.analysis_version == archive.analysis_version
                        and ref.reviewed_at >= archive.analyzed_at]
    result = archive.model_dump(mode="json", exclude={"source", "binding", "core_levels"})
    result.update(id=archive_id, core_levels=[])
    for row in archive.core_levels:
        core_references = [ref for ref in matching_version if (ref.core_id, ref.level_id) == (row.core_id, row.level_id)]
        findings = {}
        for key in OUTPUTS:
            value = getattr(row.findings, key)
            reviewed = [ref for ref in core_references if getattr(ref.findings, key) is not None]
            state = "unsupported" if key not in archive.capabilities else "not_reported" if value is None else "unverified"
            if value is not None and len(reviewed) == 1 and same_finding(value, getattr(reviewed[0].findings, key)):
                approval = reviewed[0]
                payload = value.model_dump(mode="json") if isinstance(value, Length) else value
                if isinstance(value, Length):
                    payload["mm"] = value.mm
                findings[key] = {"status": "verified", "value": payload,
                                 "evidence": approval.model_dump(mode="json", include={
                                     "reference", "review_version", "reviewed_by", "reviewed_at"})}
            else:
                findings[key] = {"status": state, "value": None, "evidence": None}
        result["core_levels"].append({**row.model_dump(mode="json", exclude={"findings"}), "findings": findings})
    return result


def archives_for(path, organization, binding):
    if not result_root(organization, {}).parent.is_dir():
        return []
    stat = path.stat()
    signature = scan_signature(path, stat.st_size, stat.st_mtime_ns)
    folder = result_root(organization, signature)
    evidence = registry(folder / "validation-evidence.json")
    summaries = []
    for item in sorted(folder.glob("*.json")):
        if not re.fullmatch(r"[a-f0-9]{64}", item.stem):
            continue
        if item.stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("Archive exceeds the size limit")
        raw = item.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item.stem:
            raise ValueError("Archive digest does not match its name")
        result = Archive.model_validate_json(raw)
        if result.source.model_dump(mode="json") == signature and result.binding == binding:
            summaries.append((result.analyzed_at, display_archive(item.stem, result, evidence)))
    return [item for _, item in sorted(summaries, key=lambda item: item[0], reverse=True)]


@router.get("/{scan_id}/prostate")
async def prostate_results(scan_id: UUID, user: CurrentUser, session: Session, response: Response):
    response.headers.update(PRIVATE)
    path = await registered_path("clinical", scan_id, user, session)
    record = (await session.execute(visible_scan(
        user, scan_id, Case.id, Specimen.id, Slide.id, Slide.block_id, Slide.stain))).one_or_none()
    if record is None:
        raise HTTPException(404, "Registered WSI not found.")
    case_id, specimen_id, slide_id, block_id, stain = record
    if re.sub(r"[^a-z]", "", (stain or "").lower()) != "he":
        return {"status": "stain_unverified", "results": []}
    binding = Binding(case_id=case_id, specimen_id=specimen_id, slide_id=slide_id, block_id=block_id)
    try:
        results = await asyncio.to_thread(archives_for, path, user.organization, binding)
    except (OSError, ValueError, openslide.OpenSlideError) as error:
        raise HTTPException(503, "Prostate AI results could not be verified for this scan.") from error
    return {"status": "available" if results else "not_linked", "results": results}
