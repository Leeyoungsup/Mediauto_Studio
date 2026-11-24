import asyncio
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.auth import CurrentUser, Session, WRITERS
from app.clinical import case_visibility
from app.intake import DATA_ROOT, scan_files, slide_entries
from app.models import AuthUser, Case, ClinicalEvent, Patient, Slide, SlideScan, Specimen
from app.workflow import eligible_assignees
from app.worklist_views import CaseStatus, Scope, SortTerm, ensure_unique

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
            "specimen": fields.get("specimen") or "미입력", "state": "열람 가능",
            "wsi": {"id": source.id, "source": "files", "format": source.format},
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
            "patient": {"id": patient.id, "name": patient.display_name or "", "number": "", "birth": patient.birth_date or "", "localRef": patient.local_reference or ""} if patient else None,
            "specimen": "", "slides": [], "history": [],
        }
    specimen_map = {item.id: item for item in specimens}
    for specimen in specimens:
        item = details[specimen.case_id]
        description = specimen.description or specimen.specimen_number
        item["specimen"] = f"{item['specimen']}, {description}" if item["specimen"] else description
    scans_by_slide = {}
    scans = await session.scalars(select(SlideScan).where(
        SlideScan.organization == organization, SlideScan.slide_id.in_([slide.id for slide in slides]),
    ).order_by(SlideScan.created_at, SlideScan.id))
    for scan in scans:
        scans_by_slide.setdefault(scan.slide_id, []).append(scan)
    for slide in slides:
        specimen = specimen_map[slide.specimen_id]
        base = {"label": slide.slide_number, "stain": slide.stain or "미입력", "specimen": specimen.specimen_number}
        tray = details[specimen.case_id]["slides"]
        if slide.id not in scans_by_slide:
            tray.append({**base, "id": slide.id, "state": "스캔 미등록"})
        for scan in scans_by_slide.get(slide.id, []):
            tray.append({**base, "id": scan.id, "state": "열람 가능",
                         "wsi": {"id": scan.id, "source": "clinical", "format": scan.format}})
    return details


def reference_row(record):
    return {
        "record_id": record.id, "case_number": record.case_number, "status": record.status,
        "assigned_to": record.assigned_to, "version": record.version, "created_at": record.created_at.isoformat(),
    }


def accessible_cases(user):
    return select(Case).where(Case.organization == user.organization, case_visibility(Case, user))


LEGACY_ORDER = {
    "recent": [SortTerm(field="created_at", direction="desc"), SortTerm(field="case_number", direction="desc")],
    "oldest": [SortTerm(field="created_at", direction="asc"), SortTerm(field="case_number", direction="asc")],
    "case": [SortTerm(field="case_number", direction="asc")],
}
STATUS_ORDER = {state: index for index, state in enumerate(("registered", "assigned", "in_review", "reviewed"))}


def parse_order(order, legacy):
    if not order:
        return LEGACY_ORDER[legacy]
    try:
        if len(order) > 3:
            raise ValueError("Maximum three sort keys")
        terms = []
        for item in order:
            field, direction = item.split(":", 1)
            terms.append(SortTerm(field=field, direction=direction))
        return ensure_unique(terms, "field")
    except ValueError as exc:
        raise HTTPException(422, "서로 다른 정렬 기준을 최대 3개 지정하세요.") from exc


def utc_timestamp(value):
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)).timestamp()
    except (TypeError, ValueError, AttributeError):
        return None


async def sorted_rows(session, organization, filtered, staff, terms):
    names = {user.id: user.display_name.casefold() for user in staff}
    counts = {}
    if filtered and any(term.field == "slide_count" for term in terms):
        ids = [row["record_id"] for row in filtered if row["record_id"]]
        counts = dict((await session.execute(select(Specimen.case_id, func.count())
            .join(Slide, Slide.specimen_id == Specimen.id)
            .outerjoin(SlideScan, SlideScan.slide_id == Slide.id)
            .where(Specimen.organization == organization, Specimen.case_id.in_(ids))
            .group_by(Specimen.case_id))).all())

    def slide_count(row):
        return counts.get(row["record_id"], 0) if row["record_id"] else len(row["slides"])

    keys = {"case_number": lambda row: row["case_number"].casefold(),
            "created_at": lambda row: utc_timestamp(row["created_at"]),
            "status": lambda row: STATUS_ORDER.get(row["status"]),
            "assignee": lambda row: names.get(row["assigned_to"]),
            "slide_count": slide_count}
    ordered = sorted(filtered, key=lambda row: (row["case_number"].casefold(), row["case_number"], str(row["record_id"] or "")))
    for term in reversed(terms):
        values, missing = [], []
        for row in ordered:
            key = keys[term.field](row)
            if key is None:
                missing.append(row)
            else:
                values.append((key, row))
        values.sort(key=lambda pair: pair[0], reverse=term.direction == "desc")
        ordered = [row for _, row in values] + missing
    return ordered


@router.get("")
async def worklist(
    user: CurrentUser, session: Session,
    scope: Scope = "all",
    q: Annotated[str, Query(max_length=80)] = "",
    status: CaseStatus | None = None,
    assigned_to: UUID | None = None,
    sort: Literal["recent", "oldest", "case"] = "recent",
    order: Annotated[list[str] | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    terms = parse_order(order, sort)
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
    filtered = await sorted_rows(session, user.organization, filtered, staff, terms)
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
    events = (await session.scalars(select(ClinicalEvent).where(
        ClinicalEvent.organization == user.organization, ClinicalEvent.record_type == "cases",
        ClinicalEvent.record_id == record.id,
    ).order_by(ClinicalEvent.version.desc()).limit(50))).all()

    def account_id(value):
        try:
            return UUID(value) if value else None
        except ValueError:
            return None

    account_ids = {account_id(value) for event in events
                   for value in (event.actor, event.before.get("assigned_to"), event.after.get("assigned_to"))} - {None}
    names = {account.id: account.display_name for account in await session.scalars(select(AuthUser).where(
        AuthUser.organization == user.organization, AuthUser.id.in_(account_ids),
    ))}
    result["history"] = [f"{event.occurred_at.isoformat()} · {event.action}" for event in events]
    result["audit"] = [{
        "id": event.id, "action": event.action, "version": event.version, "occurred_at": event.occurred_at,
        "actor": event.actor, "actor_name": names.get(account_id(event.actor)), "source": event.source,
        "reason": event.reason, "before": event.before, "after": event.after,
        "before_assignee": names.get(account_id(event.before.get("assigned_to"))),
        "after_assignee": names.get(account_id(event.after.get("assigned_to"))),
        "transaction_id": event.transaction_id,
    } for event in events]
    if user.role == "admin" and record.status != "reviewed":
        result["candidates"] = [{"id": doctor.id, "name": doctor.display_name, "username": doctor.username}
                                for doctor in await session.scalars(eligible_assignees(user.organization)
                                .order_by(AuthUser.display_name, AuthUser.username))]
    return result
