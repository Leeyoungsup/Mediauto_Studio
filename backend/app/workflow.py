"""Case assignment and review for a single IMS case and its audit trail."""

import asyncio
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, StringConstraints
from sqlalchemy import select

from app import intake
from app.auth import require_organization
from app.clinical import (
    ClinicalInput, Organization, Reason, Session, add_event, find, public_fields, relationship_state,
    require_version, scan_metadata, write,
)
from app.models import AuthUser, Case, Patient, Slide, SlideScan, Specimen, SpecimenBlock
from app.scan_quality import BLOCKED_QC
from app.workgroup_policy import GroupKey, Priority, group_member, lock_group, member_filter

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Case workflow"])


class CaseChange(ClinicalInput):
    version: int = Field(ge=1)
    reason: Reason


class Assignment(CaseChange):
    assignee_id: UUID


class Review(CaseChange):
    status: Literal["in_review", "reviewed"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


def eligible_assignees(organization, group_key=None):
    query = select(AuthUser).where(
        AuthUser.organization == organization, AuthUser.role == "doctor", AuthUser.active.is_(True),
    )
    return query.where(member_filter(organization, group_key)) if group_key else query


def record_change(session, case, action, before, reason, *, note=""):
    case.version += 1
    after = relationship_state(case)
    if note:
        after["review_note"] = note
    add_event(session, case, action, before, after, reason, source="ims")
    return public_fields(case)


@router.patch("/cases/{case_id}/assignment")
async def assign_case(organization: Organization, case_id: UUID, data: Assignment, session: Session):
    async with write(session, ("admin",)):
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.version)
        if case.status not in ("registered", "assigned", "in_review"):
            raise HTTPException(409, "Assignment cannot be changed in the current status.")
        if case.group_key:
            await lock_group(session, session.info["user"], case.group_key)
        assignee = await session.scalar(eligible_assignees(organization, case.group_key).where(AuthUser.id == data.assignee_id).with_for_update())
        if assignee is None:
            raise HTTPException(422, "Select an active pathologist eligible for this workgroup.")
        if case.assigned_to == assignee.id:
            return public_fields(case)
        before = relationship_state(case)
        action = "reassigned" if case.assigned_to else "assigned"
        case.assigned_to = assignee.id
        case.status = "assigned"
        return record_change(session, case, action, before, data.reason)


class Classification(CaseChange):
    group_key: GroupKey | None
    priority: Priority | None


@router.patch("/cases/{case_id}/classification")
async def classify_case(organization: Organization, case_id: UUID, data: Classification, session: Session):
    async with write(session):
        user = session.info["user"]
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.version)
        if case.status == "reviewed":
            raise HTTPException(409, "Classification is locked after review.")
        if data.group_key != case.group_key:
            keys = {data.group_key}
            if user.role != "admin":
                keys.add(case.group_key)
            for key in sorted(keys - {None}):
                await lock_group(session, user, key)
            if data.group_key:
                if case.assigned_to and not await group_member(session, organization, data.group_key, case.assigned_to):
                    raise HTTPException(409, "The assigned pathologist is not a member of the selected workgroup.")
        elif data.group_key and user.role != "admin":
            await lock_group(session, user, data.group_key)
        if (case.group_key, case.priority) == (data.group_key, data.priority):
            return public_fields(case)
        before = relationship_state(case)
        case.group_key = data.group_key
        if case.priority != data.priority:
            case.priority = data.priority
            case.priority_source = "manual" if data.priority else None
        return record_change(session, case, "classification_changed", before, data.reason)


@router.patch("/cases/{case_id}/review")
async def review_case(organization: Organization, case_id: UUID, data: Review, session: Session):
    async with write(session, ("doctor",)):
        # The role-scoped lookup restricts the row to the current assignee, including after reassignment.
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.version)
        transitions = {"assigned": "in_review", "in_review": "reviewed"}
        if transitions.get(case.status) != data.status:
            raise HTTPException(409, "The case cannot move to the requested review status.")
        scan = await session.scalar(select(SlideScan.id).join(Slide, SlideScan.slide_id == Slide.id)
                                    .join(Specimen, Slide.specimen_id == Specimen.id)
                                    .where(Specimen.case_id == case.id, SlideScan.organization == organization,
                                           SlideScan.status == "registered", SlideScan.qc_status.not_in(BLOCKED_QC)).limit(1))
        if scan is None:
            raise HTTPException(409, "Link a scan before changing the review status.")
        before = relationship_state(case)
        case.status = data.status
        return record_change(session, case, "review_started" if data.status == "in_review" else "review_completed",
                             before, data.reason, note=data.note)


class FileEntry(ClinicalInput):
    id: UUID
    version: int = Field(ge=1)


class FileCase(ClinicalInput):
    patient_id: UUID | None = None
    confirm_patient: bool = False
    patient_version: Annotated[int, Field(ge=1)] | None = None
    files: list[FileEntry] = Field(min_length=1)


@router.post("/files/{case_number}/case", status_code=201)
async def confirm_file_case(organization: Organization, case_number: intake.Identifier, data: FileCase, session: Session):
    user = session.info["user"]
    require_organization(user, "local")
    async with write(session):
        files = await asyncio.to_thread(intake.scan_files, intake.DATA_ROOT)
        entries = await intake.slide_entries(session, files, lock=True)
        sources = [(file, entries[file.id]["fields"]) for file in files if file.id in entries
                   and entries[file.id]["fields"]["case_id"] == case_number]
        selected = {str(item.id): item.version for item in data.files}
        if selected != {file.id: entries[file.id]["version"] for file, _ in sources}:
            raise HTTPException(409, "The registered file list has changed. Refresh the case.")
        existing = await session.scalar(select(Case.id).where(Case.organization == organization, Case.case_number == case_number))
        if existing is not None:
            raise HTTPException(409, "A case with this Case ID already exists. Refresh the Worklist.")

        transaction_id = uuid4()
        ids = {"organization": organization, "created_by": str(user.id)}

        async def create(model, *, origin=None, **fields):
            record = model(**ids, **fields)
            session.add(record)
            await session.flush()
            after = relationship_state(record)
            if origin is not None:
                after.update(intake_file_id=origin.id, intake_version=entries[origin.id]["version"])
            add_event(session, record, "registered", {}, after, source="file_intake", transaction_id=transaction_id)
            return record

        identities = {(fields.get("patient_name", ""), fields.get("patient_number", ""))
                      for _, fields in sources if fields.get("patient_name") or fields.get("patient_number")}
        if len(identities) > 1:
            raise HTTPException(409, "Patient details differ between files. Check Slide Registration.")
        patient_id = None
        if data.patient_id:
            if not data.confirm_patient or data.patient_version is None:
                raise HTTPException(422, "Confirm that the intake and local record identify the same patient.")
            patient = await find(session, Patient, organization, data.patient_id, lock=True)
            require_version(patient, data.patient_version)
            patient_id = patient.id
        elif identities:
            name, number = next(iter(identities))
            if number and await session.scalar(select(Patient.id).where(
                Patient.organization == organization, Patient.local_reference == number,
            )):
                raise HTTPException(409, "A patient record already uses this patient ID. Review the patient link.")
            patient = await create(Patient, display_name=name or None, local_reference=number or None, source="manual")
            patient_id = patient.id

        case = await create(Case, case_number=case_number, patient_id=patient_id)
        groups = {}
        for file, fields in sources:
            specimen_key = fields.get("specimen") or ""
            groups.setdefault(specimen_key, {}).setdefault(fields["slide_id"], []).append((file, fields))
        for index, (description, slides) in enumerate(groups.items(), 1):
            specimen = await create(Specimen, case_id=case.id, specimen_number=f"F{index}", description=description or None)
            blocks = {}
            for number, alternatives in slides.items():
                stains = {fields["stain"] for _, fields in alternatives if fields.get("stain")}
                block_numbers = {fields["block_number"] for _, fields in alternatives if fields.get("block_number")}
                barcodes = {fields["barcode"].strip().upper() for _, fields in alternatives if fields.get("barcode")}
                if len(stains) > 1:
                    raise HTTPException(409, "Files with the same Slide ID have different stains. Check Slide Registration.")
                if len(block_numbers) > 1 or len(barcodes) > 1:
                    raise HTTPException(409, "Files with the same Slide ID have different blocks or barcodes. Check Slide Registration.")
                block_number = next(iter(block_numbers), None)
                if block_number and block_number not in blocks:
                    blocks[block_number] = await create(SpecimenBlock, specimen_id=specimen.id, block_number=block_number)
                barcode = next(iter(barcodes), None)
                if barcode and len(barcode) > 120:
                    raise HTTPException(422, "The barcode is too long.")
                slide = await create(Slide, specimen_id=specimen.id, slide_number=number, stain=next(iter(stains), None),
                                     block_id=blocks[block_number].id if block_number else None, barcode=barcode,
                                     status="registered")
                for file, _ in alternatives:
                    meta = await asyncio.to_thread(scan_metadata, file.filename, intake.DATA_ROOT)
                    if intake.source_id(file.filename, meta["size_bytes"], meta["modified_ns"]) != file.id:
                        raise HTTPException(409, "The scan file changed while you were confirming the case.")
                    await create(SlideScan, origin=file, slide_id=slide.id, **meta)
        return public_fields(case)
