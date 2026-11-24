"""Immutable Pap screening candidates and private viewer resume pointers."""

import asyncio
import hashlib
import os
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import openslide
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import AwareDatetime, Field, model_validator
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser, Session
from app.clinical import ClinicalInput
from app.intake import source_id
from app.models import Case, PapGalleryCursor, Slide, SlideScan, Specimen
from app.pdl1 import SnapshotId, scan_signature, signature_key
from app.prostate_results import Binding, DIGEST, IDENTIFIER, MAX_ARCHIVE_BYTES, Model, SlideIdentity, TEXT
from app.scan_quality import BLOCKED_QC
from app.wsi import PRIVATE, lock_scan_case, registered_file, scan_response, verified_scan_path, visible_scan

router = APIRouter(prefix="/api/wsi/clinical/{scan_id}/pap", tags=["Pap Gallery"])
PAGE_SIZE = 18
Pixel = Annotated[int, Field(strict=True, ge=0)]
Bounds = tuple[Pixel, Pixel, Pixel, Pixel]
CategoryCode = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,47}$")]


class Category(ClinicalInput):
    code: CategoryCode
    label: TEXT


class Candidate(ClinicalInput):
    id: IDENTIFIER
    category: CategoryCode
    bounds: Bounds
    confidence: Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)] | None = None


class Archive(ClinicalInput):
    schema_version: Literal["pap-candidates-v1"]
    source: SlideIdentity
    binding: Binding
    scope: Literal["cervical_cytology"]
    preparation: Literal["conventional", "liquid_based"]
    model: Model
    analysis_version: TEXT
    exported_at: AwareDatetime
    categories: Annotated[list[Category], Field(min_length=1, max_length=48)]
    candidates: Annotated[list[Candidate], Field(max_length=25000)]

    @model_validator(mode="after")
    def verify_candidates(self):
        categories = {item.code for item in self.categories}
        if len(categories) != len(self.categories) or len({item.id for item in self.candidates}) != len(self.candidates):
            raise ValueError("Category codes and candidate IDs must be unique")
        width, height = self.source.dimensions
        for item in self.candidates:
            left, top, right, bottom = item.bounds
            if item.category not in categories:
                raise ValueError("Candidate refers to an undefined category")
            if not (0 <= left < right <= width and 0 <= top < bottom <= height
                    and max(right - left, bottom - top) <= 4096):
                raise ValueError("Candidate crop must be within the Level 0 scan and at most 4096 pixels per axis")
        return self


class Selection(ClinicalInput):
    archive_id: DIGEST
    candidate_id: IDENTIFIER
    expected_version: Annotated[int, Field(strict=True, ge=0)]


@dataclass(frozen=True)
class Context:
    path: Path
    fingerprint: UUID
    binding: Binding
    signature: dict
    folder: Path


def folder_for(organization, signature):
    root = Path(os.environ.get("MEDIAUTO_PAP_ROOT", Path(__file__).resolve().parents[2] / ".runtime" / "pap"))
    return root / organization / signature_key(signature)


async def scan_binding(session, user, scan_id, case_id=None, *, lock_specimen=False):
    query = visible_scan(user, scan_id, Case.id, Specimen.id, Slide.id, Slide.block_id, Slide.stain)
    if case_id:
        query = query.where(Case.id == case_id)
        query = (query.with_for_update(of=(Slide, Specimen)) if lock_specimen
                 else query.with_for_update(read=True, of=(Slide, Specimen)))
    record = (await session.execute(query)).one_or_none()
    if record is None:
        raise HTTPException(404, "Registered WSI not found.")
    case_id, specimen_id, slide_id, block_id, stain = record
    if re.sub(r"[^a-z]", "", (stain or "").lower()) not in ("pap", "papanicolaou", "papsmear", "papanicolaoustain"):
        return None
    return Binding(case_id=case_id, specimen_id=specimen_id, slide_id=slide_id, block_id=block_id)


async def load_context(session, user, scan_id):
    path, fingerprint = await registered_file("clinical", scan_id, user, session)
    binding = await scan_binding(session, user, scan_id)
    if binding is None:
        return None
    await session.rollback()
    try:
        stat = await asyncio.to_thread(path.stat)
        signature = await asyncio.to_thread(scan_signature, path, stat.st_size, stat.st_mtime_ns)
    except (OSError, ValueError, openslide.OpenSlideError) as error:
        raise HTTPException(503, "Unable to verify this Pap scan.") from error
    return Context(path, fingerprint, binding, signature, folder_for(user.organization, signature))


@lru_cache(maxsize=6)
def read_archive(path, size, modified_ns, changed_ns):
    if size > MAX_ARCHIVE_BYTES:
        raise ValueError("Pap export exceeds the size limit")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != path.stem:
        raise ValueError("Pap export digest differs from the stored version")
    archive = Archive.model_validate_json(raw)
    return archive, {item.id: item for item in archive.candidates}


def find_archive(context, archive_id):
    if context is None:
        raise HTTPException(404, "Pap archive not found for this scan.")
    path = context.folder / (archive_id + ".json")
    try:
        stat = path.stat()
        archive, index = read_archive(path, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    except FileNotFoundError:
        raise HTTPException(404, "Pap archive not found for this scan.") from None
    except (OSError, ValueError) as error:
        raise HTTPException(503, "Pap archive could not be verified.") from error
    if archive.binding != context.binding or archive.source.model_dump(mode="json") != context.signature:
        raise HTTPException(404, "Pap archive not found for this scan.")
    return archive, index


def archives(context):
    results = []
    failed = False
    for path in context.folder.glob("*.json"):
        if not re.fullmatch(r"[a-f0-9]{64}", path.stem):
            continue
        try:
            archive, _ = find_archive(context, path.stem)
        except HTTPException as error:
            failed |= error.status_code == 503
            continue
        counts = Counter(item.category for item in archive.candidates)
        results.append((archive.exported_at, {
            **archive.model_dump(mode="json", exclude={"binding", "source", "categories", "candidates"}),
            "id": path.stem, "candidate_count": len(archive.candidates),
            "categories": [{**item.model_dump(), "count": counts[item.code]} for item in archive.categories],
        }))
    ordered = [row for _, row in sorted(results, key=lambda item: item[0], reverse=True)]
    return ordered, failed


def cursor_key(user, scan_id, context):
    return {"organization": user.organization, "user_id": user.id, "scan_id": scan_id, "case_id": context.binding.case_id}


def resume_pointer(context, cursor):
    if cursor is None:
        return None
    try:
        archive, indexed = find_archive(context, cursor.archive_id)
    except HTTPException:
        return None
    candidate = indexed.get(cursor.candidate_id)
    if candidate is None:
        return None
    category = candidate.category
    candidates = [item.id for item in archive.candidates if item.category == category]
    page = candidates.index(candidate.id) // PAGE_SIZE + 1
    return {"archive_id": cursor.archive_id, "candidate": candidate.model_dump(mode="json"), "page": page}


@router.get("")
async def sources(scan_id: UUID, response: Response, user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    context = await load_context(session, user, scan_id)
    if context is None:
        return {"status": "stain_unverified", "archives": [], "cursor_version": 0, "resume": None}
    results, failed = await asyncio.to_thread(archives, context)
    cursor = await session.get(PapGalleryCursor, cursor_key(user, scan_id, context))
    resume = await asyncio.to_thread(resume_pointer, context, cursor)
    return {"status": "available" if results else "archive_error" if failed else "not_received",
            "partial_error": failed and bool(results), "archives": results, "cursor_version": cursor.version if cursor else 0,
            "resume": resume, "resume_unavailable": cursor is not None and resume is None}


@router.get("/{archive_id}")
async def candidates(scan_id: UUID, archive_id: SnapshotId, response: Response, user: CurrentUser, session: Session,
                     category: Annotated[CategoryCode | None, Query()] = None,
                     page: Annotated[int, Query(ge=1, le=25000)] = 1):
    response.headers.update(PRIVATE)
    context = await load_context(session, user, scan_id)
    archive, _ = await asyncio.to_thread(find_archive, context, archive_id)
    if category is not None and not any(item.code == category for item in archive.categories):
        raise HTTPException(404, "Pap category not found.")
    rows = archive.candidates if category is None else [item for item in archive.candidates if item.category == category]
    start = (page - 1) * PAGE_SIZE
    return {"total": len(rows), "page_size": PAGE_SIZE, "candidates": rows[start:start + PAGE_SIZE]}


@router.get("/{archive_id}/candidates/{candidate_id}/thumbnail")
async def thumbnail(scan_id: UUID, archive_id: SnapshotId, candidate_id: IDENTIFIER,
                    request: Request, user: CurrentUser, session: Session):
    context = await load_context(session, user, scan_id)
    _, candidates = await asyncio.to_thread(find_archive, context, archive_id)
    candidate = candidates.get(candidate_id)
    if candidate is None:
        raise HTTPException(404, "Pap candidate not found in this archive.")
    left, top, right, bottom = candidate.bounds
    return await scan_response(request, context.path, "capture", ("rectangle", [(left, top), (right, bottom)], False, False, 192))


@router.put("/selection")
async def save_selection(scan_id: UUID, payload: Selection, response: Response, user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    context = await load_context(session, user, scan_id)
    _, candidates = await asyncio.to_thread(find_archive, context, payload.archive_id)
    if payload.candidate_id not in candidates:
        raise HTTPException(404, "Pap candidate not found in this archive.")
    case_id = await lock_scan_case(session, user, scan_id)
    binding = await scan_binding(session, user, scan_id, case_id)
    scan = await session.scalar(visible_scan(user, scan_id, SlideScan).where(Case.id == case_id)
                                .with_for_update(read=True, of=SlideScan))
    if binding != context.binding or scan is None or scan.qc_status in BLOCKED_QC:
        raise HTTPException(409, "The registered Pap scan changed. Reopen it before selecting a candidate.")
    path, meta = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    fingerprint = UUID(source_id(meta["storage_key"], meta["size_bytes"], meta["modified_ns"]))
    if path != context.path or fingerprint != context.fingerprint:
        raise HTTPException(409, "The registered Pap scan changed. Reopen it before selecting a candidate.")
    key = cursor_key(user, scan_id, context)
    cursor = await session.get(PapGalleryCursor, key, with_for_update=True)
    if cursor and (cursor.archive_id, cursor.candidate_id) == (payload.archive_id, payload.candidate_id):
        return {"version": cursor.version}
    version = cursor.version if cursor else 0
    if version != payload.expected_version:
        raise HTTPException(409, "Your Pap selection changed in another session. Reload the gallery.")
    if cursor is None:
        statement = insert(PapGalleryCursor).values(**key, archive_id=payload.archive_id, candidate_id=payload.candidate_id, version=1)
        inserted = await session.scalar(statement.on_conflict_do_nothing().returning(PapGalleryCursor.version))
        if inserted is None:
            cursor = await session.get(PapGalleryCursor, key)
            if cursor and (cursor.archive_id, cursor.candidate_id) == (payload.archive_id, payload.candidate_id):
                return {"version": cursor.version}
            raise HTTPException(409, "Your Pap selection changed in another session. Reload the gallery.")
    else:
        cursor.archive_id = payload.archive_id
        cursor.candidate_id = payload.candidate_id
        cursor.version = version + 1
        cursor.saved_at = func.now()
    await session.commit()
    return {"version": version + 1}
