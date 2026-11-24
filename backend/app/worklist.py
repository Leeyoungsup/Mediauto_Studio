import asyncio
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.auth import CurrentUser, Session, WRITERS
from app.clinical import case_visibility
from app.intake import DATA_ROOT, scan_files, slide_entries
from app.models import AuthUser, Case, ClinicalEvent, Patient, Slide, Specimen

router = APIRouter(prefix="/api/worklist", tags=["Worklist"])


async def legacy_rows(session, user, case_numbers):
    if user.role not in WRITERS or user.organization != "local":
        return []
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    entries = await slide_entries(session, sources)
    groups = {}
    specimens = {}
    patients = {}
    for source in sources:
        entry = entries.get(source.id)
        if not entry:
            continue
        fields = entry["fields"]
        case_number = fields["case_id"]
        if case_number in case_numbers:
            continue
        group = groups.setdefault(case_number, {
            "record_id": None, "case_number": case_number, "assigned_to": None,
            "assignee": None, "status": "registered", "source": "files",
            "created_at": entry["updated_at"], "specimen": "", "patient": None, "slides": [], "history": [],
        })
        if fields.get("specimen"):
            specimens.setdefault(case_number, {})[fields["specimen"]] = None
        name, number = fields.get("patient_name", ""), fields.get("patient_number", "")
        if name or number:
            patients.setdefault(case_number, set()).add((name, number))
        if entry["updated_at"] > group["created_at"]:
            group["created_at"] = entry["updated_at"]
        source_label = "수기 등록" if entry["source"] == "manual" else "파일명 규칙 등록"
        group["history"].append(f"{source_label} · {fields['slide_id']} ({source.format})")
        group["slides"].append({
            "id": source.id, "label": fields["slide_id"], "stain": fields.get("stain") or "미입력",
            "specimen": fields.get("specimen") or "미입력", "state": "뷰어 연동 전",
        })
    for case_number, group in groups.items():
        group["specimen"] = ", ".join(specimens.get(case_number, {}))
        identities = patients.get(case_number, set())
        if len(identities) == 1:
            name, number = next(iter(identities))
            group["patient"] = {"name": name, "number": number, "birth": ""}
        elif len(identities) > 1:
            group["history"].append("파일별 환자 정보가 다릅니다. 슬라이드 목록에서 확인하세요.")
    return list(groups.values())


async def clinical_details(session, organization, references):
    if not references:
        return {}
    case_ids = [record.id for record in references]
    specimens = (await session.scalars(select(Specimen).where(
        Specimen.organization == organization, Specimen.case_id.in_(case_ids),
    ).order_by(Specimen.specimen_number))).all()
    slides = (await session.scalars(select(Slide).where(
        Slide.organization == organization, Slide.specimen_id.in_([item.id for item in specimens]),
    ).order_by(Slide.slide_number))).all()
    patients = {patient.id: patient for patient in await session.scalars(select(Patient).where(
        Patient.organization == organization, Patient.id.in_([item.patient_id for item in references if item.patient_id]),
    ))}
    staff = {user.id: user.display_name for user in await session.scalars(select(AuthUser).where(
        AuthUser.organization == organization, AuthUser.id.in_([item.assigned_to for item in references if item.assigned_to]),
    ))}
    details = {}
    for record in references:
        patient = patients.get(record.patient_id)
        details[record.id] = {
            **reference_row(record), "source": "clinical", "assignee": staff.get(record.assigned_to),
            "patient": {"name": patient.display_name or "", "number": "", "birth": patient.birth_date or ""} if patient else None,
            "specimen": "", "slides": [], "history": [],
        }
    specimen_map = {item.id: item for item in specimens}
    for specimen in specimens:
        item = details[specimen.case_id]
        description = specimen.description or specimen.specimen_number
        item["specimen"] = f"{item['specimen']}, {description}" if item["specimen"] else description
    for slide in slides:
        specimen = specimen_map[slide.specimen_id]
        details[specimen.case_id]["slides"].append({
            "id": slide.id, "label": slide.slide_number, "stain": slide.stain or "미입력",
            "specimen": specimen.specimen_number, "state": "뷰어 연동 전",
        })
    return details


def reference_row(record):
    return {
        "record_id": record.id, "case_number": record.case_number, "status": record.status,
        "assigned_to": record.assigned_to, "created_at": record.created_at.isoformat(),
    }


def accessible_cases(user):
    return select(Case).where(Case.organization == user.organization, case_visibility(Case, user))


@router.get("")
async def worklist(
    user: CurrentUser, session: Session,
    scope: Literal["all", "mine", "unassigned"] = "all",
    q: Annotated[str, Query(max_length=80)] = "",
    status: Literal["registered", "assigned", "in_review", "reviewed"] | None = None,
    assigned_to: UUID | None = None,
    sort: Literal["recent", "oldest", "case"] = "recent",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    records = (await session.scalars(accessible_cases(user))).all()
    lookup = {record.id: record for record in records}
    rows = [reference_row(record) for record in records]
    rows.extend(await legacy_rows(session, user, {record.case_number for record in records}))
    staff = (await session.scalars(select(AuthUser).where(
        AuthUser.organization == user.organization, AuthUser.id.in_({record.assigned_to for record in records if record.assigned_to}),
    ).order_by(AuthUser.display_name))).all()
    counts = {
        "all": len(rows),
        "mine": sum(row["assigned_to"] == user.id for row in rows),
        "unassigned": sum(row["assigned_to"] is None for row in rows),
        "statuses": {key: sum(row["status"] == key for row in rows) for key in ("registered", "assigned", "in_review", "reviewed")},
    }
    keyword = q.strip().casefold()
    filtered = [
        row for row in rows
        if (scope == "all" or row["assigned_to"] == (user.id if scope == "mine" else None))
        and (status is None or row["status"] == status)
        and (assigned_to is None or row["assigned_to"] == assigned_to)
        and (not keyword or keyword in row["case_number"].casefold())
    ]
    if sort == "case":
        filtered.sort(key=lambda row: row["case_number"].casefold())
    else:
        filtered.sort(key=lambda row: (row["created_at"], row["case_number"]), reverse=sort == "recent")
    page = filtered[offset:offset + limit]
    details = await clinical_details(session, user.organization, [lookup[row["record_id"]] for row in page if row["record_id"]])
    return {"rows": [details.get(row["record_id"], row) for row in page], "total": len(filtered), "counts": counts,
            "assignees": [{"id": item.id, "name": item.display_name} for item in staff]}


@router.get("/{case_id}")
async def worklist_case(case_id: UUID, user: CurrentUser, session: Session):
    record = await session.scalar(accessible_cases(user).where(Case.id == case_id))
    if record is None:
        raise HTTPException(404, "케이스를 찾을 수 없습니다.")
    result = (await clinical_details(session, user.organization, [record]))[record.id]
    events = await session.scalars(select(ClinicalEvent).where(
        ClinicalEvent.organization == user.organization, ClinicalEvent.record_type == "cases",
        ClinicalEvent.record_id == record.id,
    ).order_by(ClinicalEvent.version.desc()))
    result["history"] = [
        f"{event.occurred_at.isoformat()} · {event.action}" for event in events
    ]
    return result
