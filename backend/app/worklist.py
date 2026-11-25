import asyncio
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Request, APIRouter, HTTPException, Path, Query
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from pydantic import Field, StringConstraints

from app.case_activity import attempt_id, record_activity
from app.auth import CurrentUser, Session, WRITERS
from app.clinical import case_visibility
from app.intake import DATA_ROOT, scan_files, slide_entries
from app.models import AuthUser, Case, ClinicalEvent, Patient, Slide, SlideScan, Specimen, SpecimenBlock, Workgroup, WorklistOpen
from app.workflow import eligible_assignees
from app.scan_quality import BLOCKED_QC
from app.workgroup_policy import get_groups
from app.worklist_data import WORKLIST_ZONE, add_open_times, assignment_workload, file_metadata, matches_advanced, read_metadata, record_key, row_fields
from app.worklist_views import AdvancedFilters, CaseStatus, Scope, SortTerm, ensure_unique

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
            "created_at": entry["updated_at"], "accessioned_at": None, "specimen": "", "patient": None, "slides": [], "history": [],
        })
        if fields.get("specimen"):
            specimens.setdefault(case_number, {})[fields["specimen"]] = None
        name, number = fields.get("patient_name", ""), fields.get("patient_number", "")
        if name or number:
            patients.setdefault(case_number, set()).add((name, number))
        if entry["updated_at"] > group["created_at"]:
            group["created_at"] = entry["updated_at"]
        source_label = "Manual Registration" if entry["source"] == "manual" else "Filename Rule Registration"
        group["history"].append(f"{source_label} · {fields['slide_id']} ({source.format})")
        group["slides"].append({
            "id": source.id, "label": fields["slide_id"], "stain": fields.get("stain") or "Not Entered",
            "specimen": fields.get("specimen") or "Not Entered", "state": "Viewable",
            "block_number": fields.get("block_number") or None,
            "wsi": {"id": source.id, "source": "files", "format": source.format},
        })
    for case_number, group in groups.items():
        group["specimen_terms"] = list(specimens.get(case_number, {}))
        group["specimen"] = ", ".join(group["specimen_terms"])
        identities = patients.get(case_number, set())
        if len(identities) == 1:
            name, number = next(iter(identities))
            group["patient"] = {"name": name, "number": number, "birth": "", "source": "file registration"}
        elif len(identities) > 1:
            group["history"].append("Patient details differ between files. Check the slide list.")
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
            "patient": {"id": patient.id, "name": patient.display_name or "", "number": "", "birth": patient.birth_date or "", "localRef": patient.local_reference or "", "sex": patient.sex, "source": patient.source} if patient else None,
            "specimen": "", "slides": [], "history": [], "specimens": [], "blocks": [],
        }
    specimen_map = {item.id: item for item in specimens}
    for specimen in specimens:
        item = details[specimen.case_id]
        item["specimens"].append({"id": specimen.id, "number": specimen.specimen_number,
                                  "collection_date": specimen.collection_date, "version": specimen.version})
        description = specimen.description or specimen.specimen_number
        item["specimen"] = f"{item['specimen']}, {description}" if item["specimen"] else description
    blocks = await session.scalars(select(SpecimenBlock).where(
        SpecimenBlock.organization == organization, SpecimenBlock.specimen_id.in_(specimen_map),
    ).order_by(SpecimenBlock.block_number, SpecimenBlock.id))
    for block in blocks:
        specimen = specimen_map[block.specimen_id]
        details[specimen.case_id]["blocks"].append({
            "id": block.id, "number": block.block_number, "specimen": specimen.specimen_number,
        })
    scans_by_slide = {}
    scans = await session.scalars(select(SlideScan).where(
        SlideScan.organization == organization, SlideScan.slide_id.in_([slide.id for slide in slides]),
        SlideScan.status == "registered", SlideScan.qc_status != "replaced",
    ).order_by(SlideScan.created_at, SlideScan.id))
    for scan in scans:
        scans_by_slide.setdefault(scan.slide_id, []).append(scan)
    for slide in slides:
        specimen = specimen_map[slide.specimen_id]
        base = {"label": slide.slide_number, "stain": slide.stain or "Not Entered",
                "specimen": specimen.specimen_number, "block_id": slide.block_id}
        tray = details[specimen.case_id]["slides"]
        if slide.id not in scans_by_slide:
            tray.append({**base, "id": slide.id, "state": "No scan registered"})
        for scan in scans_by_slide.get(slide.id, []):
            if scan.qc_status in BLOCKED_QC:
                tray.append({**base, "id": scan.id, "qc_status": scan.qc_status,
                             "state": "QC Hold" if scan.qc_status == "hold" else "Rescan Required"})
                continue
            tray.append({**base, "id": scan.id, "state": "Viewable", "qc_status": scan.qc_status,
                         "wsi": {"id": scan.id, "source": "clinical", "format": scan.format}})
    return details


def reference_row(record):
    return {
        "record_id": record.id, "case_number": record.case_number, "status": record.status,
        "assigned_to": record.assigned_to, "version": record.version, "created_at": record.created_at.isoformat(),
        "accessioned_at": record.accessioned_at, "group_key": record.group_key, "priority": record.priority,
        "priority_source": record.priority_source,
    }


def accessible_cases(user):
    return select(Case).where(Case.organization == user.organization, case_visibility(Case, user))


LEGACY_ORDER = {
    "recent": [SortTerm(field="created_at", direction="desc"), SortTerm(field="case_number", direction="desc")],
    "oldest": [SortTerm(field="created_at", direction="asc"), SortTerm(field="case_number", direction="asc")],
    "case": [SortTerm(field="case_number", direction="asc")],
}
PRIORITY_ORDER = {"frozen": 0, "urgent": 1, "routine": 2}
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
        raise HTTPException(422, "Select up to three different sort fields.") from exc


def utc_timestamp(value):
    try:
        stamp = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)).timestamp()
    except (TypeError, ValueError, AttributeError):
        return None


def sorted_rows(filtered, staff, terms):
    names = {user.id: user.display_name.casefold() for user in staff}
    keys = {"case_number": lambda row: row["case_number"].casefold(),
            "created_at": lambda row: utc_timestamp(row["created_at"]),
            "status": lambda row: STATUS_ORDER.get(row["status"]),
            "assignee": lambda row: names.get(row["assigned_to"]),
            "slide_count": lambda row: row["slide_count"],
            "accessioned_at": lambda row: row["accessioned_at"],
            "collection_date": lambda row: row["collection_date"],
            "last_opened": lambda row: row["last_opened"],
            "age": lambda row: row["age"],
            "patient_name": lambda row: ((row["patient"] or {}).get("name") or "").casefold() or None,
            "specimen": lambda row: row["specimen_label"].casefold() or None,
            "lis_status": lambda row: row["lis_status"].casefold() if row["lis_status"] else None,
            "priority": lambda row: PRIORITY_ORDER.get(row.get("priority")),
            "group": lambda row: row["group_name"].casefold() if row.get("group_name") else None}
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


class WorklistParameters(AdvancedFilters):
    scope: Scope = "all"
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    status: CaseStatus | None = None
    assigned_to: UUID | None = None
    sort: Literal["recent", "oldest", "case"] = "recent"
    order: list[str] | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)


@router.get("")
async def worklist(user: CurrentUser, session: Session, filters: Annotated[WorklistParameters, Query()]):
    return await query_worklist(user, session, filters)


@router.post("/search")
async def search_worklist(filters: WorklistParameters, user: CurrentUser, session: Session):
    return await query_worklist(user, session, filters)


async def query_worklist(user, session, filters):
    terms = parse_order(filters.order, filters.sort)
    if filters.group_key is not None and filters.group_key not in await get_groups(session, user):
        raise HTTPException(404, "Workgroup not found.")
    authorized = accessible_cases(user)
    records = (await session.scalars(authorized)).all()
    lookup = {record.id: record for record in records}
    names = dict((await session.execute(select(Workgroup.key, Workgroup.name).where(
        Workgroup.organization == user.organization, Workgroup.key.in_({record.group_key for record in records if record.group_key})))).all())
    metadata = await read_metadata(session, user, authorized, records) if records else {}
    rows = [{**reference_row(record), **metadata[record.id], "group_name": names.get(record.group_key)} for record in records]
    files = await legacy_rows(session, user, {record.case_number for record in records})
    rows.extend({**row, **file_metadata(row)} for row in files)
    await add_open_times(session, user, rows)
    staff = (await session.scalars(select(AuthUser).where(
        AuthUser.organization == user.organization, AuthUser.id.in_({record.assigned_to for record in records if record.assigned_to}),
    ).order_by(AuthUser.display_name))).all()
    counts = {
        "all": len(rows),
        "mine": sum(row["assigned_to"] == user.id for row in rows),
        "unassigned": sum(row["assigned_to"] is None for row in rows),
        "statuses": {key: sum(row["status"] == key for row in rows) for key in ("registered", "assigned", "in_review", "reviewed")},
    }
    today = datetime.now(WORKLIST_ZONE).date()
    keyword = filters.q.casefold()
    matched = [
        row for row in rows
        if (filters.scope == "all" or row["assigned_to"] == (user.id if filters.scope == "mine" else None))
        and (filters.assigned_to is None or row["assigned_to"] == filters.assigned_to)
        and (not keyword or keyword in row["case_number"].casefold())
        and matches_advanced(row, filters, today)
    ]
    filtered_counts = {key: sum(row["status"] == key for row in matched) for key in STATUS_ORDER}
    filtered = sorted_rows([row for row in matched if not filters.status or row["status"] == filters.status], staff, terms)
    page = filtered[filters.offset:filters.offset + filters.limit]
    details = await clinical_details(session, user.organization, [lookup[row["record_id"]] for row in page if row["record_id"]])
    result = []
    for row in page:
        base = details.get(row["record_id"], row)
        if not row["record_id"]:
            base = {key: value for key, value in row.items() if key not in ("slide_ids", "specimen_terms", "specimen_label")}
        result.append({**base, **row_fields(row), "patient": row["patient"], "group_name": row.get("group_name")})
    return {"rows": result, "total": len(filtered), "counts": counts, "filtered_counts": filtered_counts,
            "assignees": [{"id": item.id, "name": item.display_name} for item in staff],
            "workload": assignment_workload(filtered, staff) if user.role in ("admin", "doctor") else None}


async def remember_open(session, user, key):
    await session.execute(insert(WorklistOpen).values(
        organization=user.organization, user_id=user.id, record_key=key,
    ).on_conflict_do_update(index_elements=["organization", "user_id", "record_key"],
                            set_={"opened_at": func.greatest(WorklistOpen.opened_at, func.now())}))
    return {"ok": True}


@router.post("/cases/{case_id}/opened")
async def clinical_open(case_id: UUID, request: Request, user: CurrentUser, session: Session):
    async with session.begin():
        record = await session.scalar(accessible_cases(user).where(Case.id == case_id).with_for_update(read=True))
        if record is None:
            raise HTTPException(404, "Case not found.")
        await record_activity(session, user, record.id, "case_opened", "case", record.id, attempt_id(request))
        return await remember_open(session, user, record_key({"record_id": record.id}))


@router.post("/file-cases/{case_number}/opened")
async def file_open(case_number: Annotated[str, Path(max_length=80)], user: CurrentUser, session: Session):
    async with session.begin():
        if user.role not in WRITERS or user.organization != "local":
            raise HTTPException(404, "Case not found.")
        records = await session.scalars(accessible_cases(user).where(Case.case_number == case_number))
        groups = await legacy_rows(session, user, {record.case_number for record in records})
        row = next((row for row in groups if row["case_number"] == case_number), None)
        if not row:
            raise HTTPException(404, "Case not found.")
        return await remember_open(session, user, record_key(row))


@router.get("/{case_id}")
async def worklist_case(case_id: UUID, user: CurrentUser, session: Session):
    record = await session.scalar(accessible_cases(user).where(Case.id == case_id))
    if record is None:
        raise HTTPException(404, "Case not found.")
    result = (await clinical_details(session, user.organization, [record]))[record.id]
    if record.group_key:
        result["group_name"] = await session.scalar(select(Workgroup.name).where(
            Workgroup.organization == user.organization, Workgroup.key == record.group_key))
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
    if user.role in WRITERS and record.status != "reviewed":
        result["candidates"] = [{"id": doctor.id, "name": doctor.display_name, "username": doctor.username}
                                for doctor in await session.scalars(eligible_assignees(user.organization, record.group_key)
                                .order_by(AuthUser.display_name, AuthUser.username))]
    return result
