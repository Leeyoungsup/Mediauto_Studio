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
from app.models import AuthUser, Case, Patient, Slide, SlideScan, Specimen

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Case workflow"])


class CaseChange(ClinicalInput):
    version: int = Field(ge=1)
    reason: Reason


class Assignment(CaseChange):
    assignee_id: UUID


class Review(CaseChange):
    status: Literal["in_review", "reviewed"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


def eligible_assignees(organization):
    return select(AuthUser).where(
        AuthUser.organization == organization, AuthUser.role == "doctor", AuthUser.active.is_(True),
    )


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
            raise HTTPException(409, "현재 상태에서는 배정을 변경할 수 없습니다.")
        assignee = await session.scalar(eligible_assignees(organization).where(AuthUser.id == data.assignee_id).with_for_update())
        if assignee is None:
            raise HTTPException(422, "소속 기관의 활성 병리의 계정을 선택하세요.")
        if case.assigned_to == assignee.id:
            return public_fields(case)
        before = relationship_state(case)
        action = "reassigned" if case.assigned_to else "assigned"
        case.assigned_to = assignee.id
        case.status = "assigned"
        return record_change(session, case, action, before, data.reason)


@router.patch("/cases/{case_id}/review")
async def review_case(organization: Organization, case_id: UUID, data: Review, session: Session):
    async with write(session, ("doctor",)):
        # The role-scoped lookup restricts the row to the current assignee, including after reassignment.
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.version)
        transitions = {"assigned": "in_review", "in_review": "reviewed"}
        if transitions.get(case.status) != data.status:
            raise HTTPException(409, "현재 검토 상태에서 요청한 단계로 변경할 수 없습니다.")
        scan = await session.scalar(select(SlideScan.id).join(Slide, SlideScan.slide_id == Slide.id)
                                    .join(Specimen, Slide.specimen_id == Specimen.id)
                                    .where(Specimen.case_id == case.id, SlideScan.organization == organization,
                                           SlideScan.status == "registered").limit(1))
        if scan is None:
            raise HTTPException(409, "검토 상태를 변경하려면 연결된 스캔이 필요합니다.")
        before = relationship_state(case)
        case.status = data.status
        return record_change(session, case, "review_started" if data.status == "in_review" else "review_completed",
                             before, data.reason, note=data.note)


class FileEntry(ClinicalInput):
    id: UUID
    version: int = Field(ge=1)


class FileCase(ClinicalInput):
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
            raise HTTPException(409, "등록 파일 목록이 변경되었습니다. 케이스를 새로고침하세요.")
        existing = await session.scalar(select(Case.id).where(Case.organization == organization, Case.case_number == case_number))
        if existing is not None:
            raise HTTPException(409, "이 Case ID의 케이스가 이미 있습니다. Worklist를 갱신하세요.")

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
            raise HTTPException(409, "파일별 환자 정보가 다릅니다. 슬라이드 등록에서 확인하세요.")
        patient_id = None
        if identities:
            name, number = next(iter(identities))
            if number and await session.scalar(select(Patient.id).where(
                Patient.organization == organization, Patient.local_reference == number,
            )):
                raise HTTPException(409, "같은 환자번호의 기록이 있습니다. 환자 연결을 확인하세요.")
            patient = await create(Patient, display_name=name or None, local_reference=number or None, source="manual")
            patient_id = patient.id

        case = await create(Case, case_number=case_number, patient_id=patient_id)
        groups = {}
        for file, fields in sources:
            specimen_key = fields.get("specimen") or ""
            groups.setdefault(specimen_key, {}).setdefault(fields["slide_id"], []).append((file, fields))
        for index, (description, slides) in enumerate(groups.items(), 1):
            specimen = await create(Specimen, case_id=case.id, specimen_number=f"F{index}", description=description or None)
            for number, alternatives in slides.items():
                stains = {fields["stain"] for _, fields in alternatives if fields.get("stain")}
                if len(stains) > 1:
                    raise HTTPException(409, "같은 Slide ID에 서로 다른 염색 정보가 있습니다. 슬라이드 등록에서 확인하세요.")
                slide = await create(Slide, specimen_id=specimen.id, slide_number=number, stain=next(iter(stains), None),
                                     status="registered")
                for file, _ in alternatives:
                    meta = await asyncio.to_thread(scan_metadata, file.filename, intake.DATA_ROOT)
                    if intake.source_id(file.filename, meta["size_bytes"], meta["modified_ns"]) != file.id:
                        raise HTTPException(409, "확정하는 동안 스캔 파일이 변경되었습니다.")
                    await create(SlideScan, origin=file, slide_id=slide.id, **meta)
        return public_fields(case)
