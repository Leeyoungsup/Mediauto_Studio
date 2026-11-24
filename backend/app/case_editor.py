"""Versioned case editing, human-confirmed labels, and scan quality checks."""

import asyncio
from datetime import date
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field, StringConstraints, field_validator
from sqlalchemy import select

from app.auth import require_roles
from app.clinical import (ClinicalInput, Description, Number, Organization, Reason, Session,
    add_event, find, public_fields, require_version, write)
from app.models import Case, ClinicalEvent, Patient, ScanLabel, Slide, SlideScan, Specimen, SpecimenBlock
from app.scan_quality import MAX_LABEL_BYTES, embedded_label, inspect_scan, recognize_label, uploaded_label
from app.wsi import PRIVATE, verified_scan_path

router = APIRouter(prefix="/api/clinical/{organization}/editor", tags=["Case Editor"])
LabelText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Metadata = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
StorageKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]


class EditorChange(ClinicalInput):
    version: int = Field(ge=1)
    reason: Reason


class SpecimenEdit(EditorChange):
    specimen_number: Number
    description: Description | None = None
    collection_date: date | None = None


class BlockEdit(EditorChange):
    block_number: Number


class SlideEdit(EditorChange):
    slide_number: Number
    stain: Number | None = None
    block_id: UUID | None = None
    barcode: Metadata | None = None
    label_text: LabelText | None = None
    confirmed_ocr_scan: UUID | None = None
    confirmed_ocr_version: Annotated[int, Field(ge=1)] | None = None

    @field_validator("barcode")
    @classmethod
    def normalize_barcode(cls, value):
        if value is None:
            return None
        normalized = value.upper()
        if len(normalized) > 120:
            raise ValueError("Barcode is too long")
        return normalized


class ScannerEdit(EditorChange):
    scanner: Metadata | None = None


class Quality(EditorChange):
    source: Literal["manual", "scanner", "ai"]
    outcome: Literal["passed", "hold", "rescan_required"]
    provider: Metadata | None = None
    reference: Metadata | None = None


class Replacement(EditorChange):
    storage_key: StorageKey
    scanner: Metadata | None = None


class PatientMatch(EditorChange):
    patient_id: UUID
    patient_version: int = Field(ge=1)


class PatientSearch(ClinicalInput):
    local_reference: Number


def metadata_fields(row, names):
    return {key: str(value) if isinstance(value, UUID) else value.isoformat() if isinstance(value, date) else value
            for key in names for value in (getattr(row, key),)}


def apply_changes(session, row, values, action, reason, extra=None):
    before = metadata_fields(row, values)
    if all(getattr(row, key) == value for key, value in values.items()) and not extra:
        return public_fields(row)
    for key, value in values.items():
        setattr(row, key, value)
    row.version += 1
    add_event(session, row, action, before, {**metadata_fields(row, values), **(extra or {})}, reason, source="ims")
    return public_fields(row)


async def case_for_specimen(session, organization, specimen):
    case = await find(session, Case, organization, specimen.case_id, lock=True)
    if case.status == "reviewed":
        raise HTTPException(409, "This case is locked after review.")
    return case


async def scan_record(session, organization, scan_id, lock=False):
    scan = await find(session, SlideScan, organization, scan_id, lock=lock)
    if lock:
        slide = await find(session, Slide, organization, scan.slide_id)
        if not slide.specimen_id:
            raise HTTPException(409, "Link this slide to a specimen before using the Case Editor.")
        await case_for_specimen(session, organization, await find(session, Specimen, organization, slide.specimen_id))
        if scan.qc_status == "replaced":
            raise HTTPException(409, "This scan was replaced. Select its replacement.")
    return scan


@router.get("/cases/{case_id}")
async def editor_case(organization: Organization, case_id: UUID, session: Session):
    case = await find(session, Case, organization, case_id)
    specimens = (await session.scalars(select(Specimen).where(
        Specimen.organization == organization, Specimen.case_id == case.id).order_by(Specimen.specimen_number))).all()
    specimen_ids = [item.id for item in specimens]
    blocks = (await session.scalars(select(SpecimenBlock).where(SpecimenBlock.organization == organization,
        SpecimenBlock.specimen_id.in_(specimen_ids)).order_by(SpecimenBlock.block_number))).all()
    slides = (await session.scalars(select(Slide).where(Slide.organization == organization,
        Slide.specimen_id.in_(specimen_ids)).order_by(Slide.slide_number))).all()
    scans = (await session.scalars(select(SlideScan).where(SlideScan.organization == organization,
        SlideScan.slide_id.in_([item.id for item in slides])).order_by(SlideScan.created_at.desc(), SlideScan.id))).all()
    edited_ids = [item.id for item in (*specimens, *blocks, *slides, *scans)]
    events = (await session.scalars(select(ClinicalEvent).where(ClinicalEvent.organization == organization,
        ClinicalEvent.record_type.in_(("specimens", "specimen_blocks", "slides", "slide_scans")),
        ClinicalEvent.record_id.in_(edited_ids))
        .order_by(ClinicalEvent.occurred_at.desc(), ClinicalEvent.version.desc()).limit(150))).all()
    history = {}
    for event in events:
        history.setdefault(event.record_id, []).append({"action": event.action, "version": event.version,
            "actor": event.actor, "source": event.source, "reason": event.reason, "at": event.occurred_at,
            "before": event.before, "after": event.after})
    return {key: [{**public_fields(item), "history": history.get(item.id, [])} for item in entries]
            for key, entries in (("specimens", specimens), ("blocks", blocks), ("slides", slides), ("scans", scans))}


@router.post("/patients/match")
async def match_patient(organization: Organization, data: PatientSearch, session: Session):
    require_roles(session.info["user"], ("admin", "labeler"))
    patient = await session.scalar(select(Patient).where(
        Patient.organization == organization, Patient.local_reference == data.local_reference))
    return public_fields(patient) if patient else None


@router.patch("/cases/{case_id}/patient-match")
async def link_patient_match(organization: Organization, case_id: UUID, data: PatientMatch, session: Session):
    async with write(session):
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.version)
        if case.status == "reviewed":
            raise HTTPException(409, "This case is locked after review.")
        patient = await find(session, Patient, organization, data.patient_id, lock=True)
        require_version(patient, data.patient_version)
        return apply_changes(session, case, {"patient_id": patient.id}, "patient_id_changed", data.reason,
                             {"link_source": "confirmed_local_match"})


@router.patch("/specimens/{specimen_id}")
async def edit_specimen(organization: Organization, specimen_id: UUID, data: SpecimenEdit, session: Session):
    async with write(session):
        specimen = await find(session, Specimen, organization, specimen_id, lock=True)
        await case_for_specimen(session, organization, specimen)
        require_version(specimen, data.version)
        return apply_changes(session, specimen, data.model_dump(exclude={"version", "reason"}), "specimen_edited", data.reason)


@router.post("/specimens/{specimen_id}/blocks", status_code=201)
async def create_block(organization: Organization, specimen_id: UUID, data: BlockEdit, session: Session):
    async with write(session):
        specimen = await find(session, Specimen, organization, specimen_id, lock=True)
        await case_for_specimen(session, organization, specimen)
        require_version(specimen, data.version)
        block = await session.scalar(select(SpecimenBlock).where(SpecimenBlock.organization == organization,
            SpecimenBlock.specimen_id == specimen.id, SpecimenBlock.block_number == data.block_number))
        if block:
            return public_fields(block)
        block = SpecimenBlock(organization=organization, specimen_id=specimen.id, block_number=data.block_number,
                              created_by=str(session.info["user"].id))
        session.add(block)
        await session.flush()
        add_event(session, block, "block_registered", {}, metadata_fields(block, ("specimen_id", "block_number")), data.reason)
        return public_fields(block)


@router.patch("/blocks/{block_id}")
async def edit_block(organization: Organization, block_id: UUID, data: BlockEdit, session: Session):
    async with write(session):
        block = await session.scalar(select(SpecimenBlock).where(
            SpecimenBlock.organization == organization, SpecimenBlock.id == block_id).with_for_update())
        if block is None:
            raise HTTPException(404, "Block not found.")
        await case_for_specimen(session, organization, await find(session, Specimen, organization, block.specimen_id))
        require_version(block, data.version)
        return apply_changes(session, block, {"block_number": data.block_number}, "block_edited", data.reason)


@router.patch("/slides/{slide_id}")
async def edit_slide(organization: Organization, slide_id: UUID, data: SlideEdit, session: Session):
    async with write(session):
        slide = await find(session, Slide, organization, slide_id)
        if not slide.specimen_id:
            raise HTTPException(409, "Link the slide to a specimen before editing it.")
        await case_for_specimen(session, organization, await find(session, Specimen, organization, slide.specimen_id))
        slide = await session.scalar(select(Slide).where(Slide.id == slide_id).with_for_update()
                                     .execution_options(populate_existing=True))
        require_version(slide, data.version)
        if data.block_id and not await session.scalar(select(SpecimenBlock.id).where(
            SpecimenBlock.organization == organization, SpecimenBlock.specimen_id == slide.specimen_id,
            SpecimenBlock.id == data.block_id)):
            raise HTTPException(422, "Select a block belonging to this specimen.")
        if data.barcode and await session.scalar(select(Slide.id).where(
            Slide.organization == organization, Slide.barcode == data.barcode, Slide.id != slide.id)):
            raise HTTPException(409, "This barcode belongs to another slide.")
        extra = None
        if data.confirmed_ocr_scan or data.confirmed_ocr_version:
            scan = await session.scalar(select(SlideScan).where(SlideScan.organization == organization,
                SlideScan.id == data.confirmed_ocr_scan, SlideScan.slide_id == slide.id))
            event = await session.scalar(select(ClinicalEvent.id).where(
                ClinicalEvent.organization == organization, ClinicalEvent.record_type == "slide_scans",
                ClinicalEvent.record_id == data.confirmed_ocr_scan, ClinicalEvent.version == data.confirmed_ocr_version,
                ClinicalEvent.action == "label_ocr_generated"))
            if not data.label_text or scan is None or scan.version != data.confirmed_ocr_version or not event:
                raise HTTPException(409, "Reload the label and confirm a current OCR candidate.")
            extra = {"label_source": "ocr_confirmed", "scan_id": str(scan.id), "ocr_version": scan.version}
        elif data.label_text != slide.label_text:
            extra = {"label_source": "manual"}
        return apply_changes(session, slide, data.model_dump(exclude={
            "version", "reason", "confirmed_ocr_scan", "confirmed_ocr_version"}), "slide_edited", data.reason, extra)


async def label_bytes(session, scan, request):
    stored = await session.scalar(select(ScanLabel.jpeg).where(
        ScanLabel.organization == scan.organization, ScanLabel.scan_id == scan.id)
        .order_by(ScanLabel.version.desc()).limit(1))
    if stored is not None:
        return stored, "uploaded"
    path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    async with request.app.state.wsi_slots:
        return await asyncio.to_thread(embedded_label, path), "embedded"


@router.get("/scans/{scan_id}/label.jpeg")
async def scan_label(organization: Organization, scan_id: UUID, session: Session, request: Request):
    scan = await scan_record(session, organization, scan_id)
    data, source = await label_bytes(session, scan, request)
    return Response(data, media_type="image/jpeg", headers={**PRIVATE, "X-Label-Source": source})


@router.put("/scans/{scan_id}/label")
async def save_label(organization: Organization, scan_id: UUID, session: Session, request: Request,
                     version: Annotated[int, Query(ge=1)]):
    require_roles(session.info["user"], ("admin", "labeler"))
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > MAX_LABEL_BYTES:
            raise HTTPException(413, "Label images are limited to 2 MB.")
        payload.extend(chunk)
    async with request.app.state.wsi_slots:
        jpeg = await asyncio.to_thread(uploaded_label, payload)
    async with write(session):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, version)
        previous = await session.scalar(select(ScanLabel.id).where(
            ScanLabel.organization == organization, ScanLabel.scan_id == scan_id).order_by(ScanLabel.version.desc()).limit(1))
        label = ScanLabel(id=uuid4(), organization=organization, scan_id=scan_id, version=scan.version + 1, jpeg=jpeg)
        session.add(label)
        scan.version += 1
        add_event(session, scan, "scan_label_uploaded", {"label_id": str(previous) if previous else None},
                  {"label_id": str(label.id), "label_source": "uploaded"}, source="ims")
        return {"version": scan.version}


@router.post("/scans/{scan_id}/ocr")
async def scan_ocr(organization: Organization, scan_id: UUID, data: EditorChange, session: Session, request: Request):
    # Release read locks and the connection while the local OCR process is running.
    user = session.info["user"]
    require_roles(user, ("admin", "labeler"))
    scan = await scan_record(session, organization, scan_id)
    require_version(scan, data.version)
    label, source = await label_bytes(session, scan, request)
    await session.rollback()
    async with request.app.state.wsi_slots:
        text = await asyncio.to_thread(recognize_label, label)
    async with write(session):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, data.version)
        scan.version += 1
        add_event(session, scan, "label_ocr_generated", {}, {"label_source": source, "engine": "Tesseract"},
                  data.reason, source="ocr")
        return {"candidate": text, "scan_id": scan.id, "version": scan.version, "source": source, "engine": "Tesseract"}


@router.patch("/scans/{scan_id}")
async def edit_scan(organization: Organization, scan_id: UUID, data: ScannerEdit, session: Session):
    async with write(session):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, data.version)
        return apply_changes(session, scan, {"scanner": data.scanner}, "scanner_edited", data.reason)


@router.post("/scans/{scan_id}/qc")
async def assess_scan(organization: Organization, scan_id: UUID, data: Quality, session: Session, request: Request):
    roles = ("admin", "labeler") if data.source == "manual" else ("admin",)
    async with write(session, roles):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, data.version)
        if data.source != "manual" and (not data.provider or not data.reference):
            raise HTTPException(422, "Enter the QC provider and result reference.")
        before = {"qc_status": scan.qc_status}
        if data.source == "manual":
            if data.outcome == "passed":
                path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
                async with request.app.state.wsi_slots:
                    await asyncio.to_thread(inspect_scan, path)
            scan.qc_status = data.outcome
        scan.version += 1
        add_event(session, scan, "scan_qc_recorded", before, {"qc_status": scan.qc_status, "outcome": data.outcome,
            "provider": data.provider, "reference": data.reference}, data.reason, source=data.source)
        return public_fields(scan)


@router.post("/scans/{scan_id}/check")
async def check_scan(organization: Organization, scan_id: UUID, data: EditorChange, session: Session, request: Request):
    async with write(session):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, data.version)
        try:
            path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
            async with request.app.state.wsi_slots:
                inspection = await asyncio.to_thread(inspect_scan, path)
        except HTTPException as exc:
            inspection = {"error": exc.detail}
        scan.version += 1
        add_event(session, scan, "scan_structure_checked", {"qc_status": scan.qc_status},
                  {"qc_status": scan.qc_status, "outcome": "hold" if "error" in inspection else "passed",
                   "provider": "OpenSlide", **inspection}, data.reason, source="scanner")
        return {"version": scan.version, **inspection}


@router.post("/scans/{scan_id}/replacement", status_code=201)
async def replace_scan(organization: Organization, scan_id: UUID, data: Replacement, session: Session, request: Request):
    require_roles(session.info["user"], ("admin", "labeler"))
    path, metadata = await verified_scan_path(data.storage_key, None)
    async with request.app.state.wsi_slots:
        await asyncio.to_thread(inspect_scan, path)
    async with write(session):
        scan = await scan_record(session, organization, scan_id, lock=True)
        require_version(scan, data.version)
        if scan.qc_status not in ("hold", "rescan_required"):
            raise HTTPException(409, "Place the scan on hold or request a rescan before replacement.")
        await verified_scan_path(data.storage_key, (metadata["size_bytes"], metadata["modified_ns"]))
        new = SlideScan(organization=organization, slide_id=scan.slide_id, scanner=data.scanner,
                        replaces_id=scan.id, created_by=str(session.info["user"].id), **metadata)
        session.add(new)
        await session.flush()
        prior = scan.qc_status
        scan.qc_status = "replaced"
        scan.version += 1
        tx = uuid4()
        add_event(session, scan, "scan_replaced", {"qc_status": prior},
                  {"qc_status": "replaced", "replacement_id": str(new.id)}, data.reason, transaction_id=tx)
        add_event(session, new, "replacement_registered", {},
                  {"qc_status": new.qc_status, "replaces_id": str(scan.id)}, data.reason, transaction_id=tx)
        return public_fields(new)
