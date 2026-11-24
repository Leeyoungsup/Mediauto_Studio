"""Read models and filter rules for the authorized Worklist."""

from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select

from app.integration_service import KIND, SYSTEM
from app.models import Case, CaseRequest, ClinicalEvent, ExternalIdentifier, ExternalSnapshot, Patient, Slide, SlideScan, Specimen, WorklistOpen

WORKLIST_ZONE = ZoneInfo("Asia/Seoul")


def record_key(row):
    return f"case:{row['record_id']}" if row["record_id"] else f"file:{row['case_number']}"


def completed_years(birth, collected):
    if birth is None or collected is None or collected < birth:
        return None
    return collected.year - birth.year - ((collected.month, collected.day) < (birth.month, birth.day))


def calendar_date(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(WORKLIST_ZONE).date() if isinstance(value, datetime) else value


def clinical_age(patient, collected):
    return completed_years(patient.birth_date, collected) if patient else None


async def read_metadata(session, user, authorized_cases, records):
    organization = user.organization
    patient_ids = authorized_cases.with_only_columns(Case.patient_id)
    case_ids = authorized_cases.with_only_columns(Case.id)
    patients = {patient.id: patient for patient in await session.scalars(
        select(Patient).where(Patient.organization == organization, Patient.id.in_(patient_ids)))}
    specimens = defaultdict(list)
    for specimen in await session.scalars(select(Specimen).where(
        Specimen.organization == organization, Specimen.case_id.in_(case_ids)
    ).order_by(Specimen.specimen_number)):
        specimens[specimen.case_id].append(specimen)

    slide_query = (select(Specimen.case_id, Slide.slide_number, func.count(SlideScan.id))
                   .join(Slide, Slide.specimen_id == Specimen.id)
                   .outerjoin(SlideScan, and_(SlideScan.slide_id == Slide.id, SlideScan.status == "registered"))
                   .where(Specimen.organization == organization, Specimen.case_id.in_(case_ids))
                   .group_by(Specimen.case_id, Slide.id))
    slides = defaultdict(list)
    for case_id, number, scan_count in await session.execute(slide_query):
        slides[case_id].append((number, scan_count))

    identifiers = defaultdict(list)
    for row in await session.scalars(select(ExternalIdentifier).where(
        ExternalIdentifier.organization == organization, ExternalIdentifier.patient_id.in_(patient_ids),
        func.lower(ExternalIdentifier.kind) == "mrn", ExternalIdentifier.connection_state == "linked",
    ).order_by(ExternalIdentifier.system, ExternalIdentifier.value)):
        identifiers[row.patient_id].append({"value": row.value, "source": row.system})

    lis = defaultdict(list)
    snapshot_query = (select(ExternalIdentifier.case_id, ExternalSnapshot).join(ExternalSnapshot, and_(
        ExternalIdentifier.organization == ExternalSnapshot.organization, ExternalIdentifier.value == ExternalSnapshot.external_id,
        ExternalSnapshot.channel == "lis", ExternalSnapshot.resource == "case",
    )).where(ExternalIdentifier.organization == organization, ExternalIdentifier.case_id.in_(case_ids),
             ExternalIdentifier.kind == KIND["case"], ExternalIdentifier.system == SYSTEM["lis"],
             ExternalIdentifier.connection_state == "linked", ExternalIdentifier.last_synced_at == ExternalSnapshot.received_at,
             ExternalSnapshot.revision > 0).order_by(ExternalSnapshot.external_id))
    for case_id, snapshot in await session.execute(snapshot_query):
        state = snapshot.payload.get("external_state")
        if state:
            lis[case_id].append({"value": state, "source": SYSTEM["lis"], "received_at": snapshot.received_at})

    may_read_requests = user.role in ("admin", "doctor")
    requests = {}
    if may_read_requests:
        requests = dict((await session.execute(select(CaseRequest.case_id, func.count())
            .where(CaseRequest.organization == organization, CaseRequest.case_id.in_(case_ids))
            .group_by(CaseRequest.case_id))).all())
    note = ClinicalEvent.after["review_note"].astext
    notes = dict((await session.execute(select(ClinicalEvent.record_id, note)
        .where(ClinicalEvent.organization == organization, ClinicalEvent.record_type == "cases",
               ClinicalEvent.record_id.in_(case_ids), note.is_not(None))
        .distinct(ClinicalEvent.record_id).order_by(ClinicalEvent.record_id, ClinicalEvent.version.desc()))).all())

    result = {}
    for record in records:
        patient = patients.get(record.patient_id)
        case_specimens = specimens[record.id]
        collected = min((item.collection_date for item in case_specimens if item.collection_date), default=None)
        scan_rows = slides[record.id]
        slide_state = sorted({"viewable" if total else "missing_scan" for _, total in scan_rows}) or ["no_slides"]
        lis_values = {item["value"] for item in lis[record.id]}
        result[record.id] = {
            "patient": {"id": patient.id, "name": patient.display_name or "", "number": ", ".join(
                dict.fromkeys(item["value"] for item in identifiers[patient.id])),
                "birth": patient.birth_date or "", "localRef": patient.local_reference or "",
                "sex": patient.sex, "source": patient.source} if patient else None,
            "mrns": identifiers[record.patient_id], "collection_date": collected,
            "age": clinical_age(patient, collected),
            "specimen_terms": [value for item in case_specimens for value in (item.specimen_number, item.description) if value],
            "specimen_label": ", ".join(item.description or item.specimen_number for item in case_specimens),
            "slide_ids": [number for number, _ in scan_rows], "slide_state": slide_state,
            "slide_count": sum(max(1, total) for _, total in scan_rows), "workload_slides": len(scan_rows),
            "has_storage": any(total for _, total in scan_rows),
            "lis_status": next(iter(lis_values)) if len(lis_values) == 1 else None,
            "lis_data": "available" if len(lis_values) == 1 else "conflict" if lis_values else "missing",
            "lis_sources": lis[record.id], "request_count": requests.get(record.id, 0) if may_read_requests else None,
            "review_note": notes.get(record.id),
        }
    return result


def file_metadata(row):
    patient = row["patient"]
    return {
        "mrns": [{"value": patient["number"], "source": "File registration (unverified)"}] if patient and patient["number"] else [],
        "collection_date": None, "age": None, "specimen_terms": row["specimen_terms"],
        "specimen_label": row["specimen"], "slide_ids": [slide["label"] for slide in row["slides"]],
        "slide_state": ["viewable"], "slide_count": len(row["slides"]), "has_storage": True,
        "workload_slides": len({(slide["specimen"], slide["label"]) for slide in row["slides"]}),
        "lis_status": None, "lis_data": "missing", "lis_sources": [], "request_count": None, "review_note": None,
    }


async def add_open_times(session, user, rows):
    by_key = dict((await session.execute(select(WorklistOpen.record_key, WorklistOpen.opened_at).where(
        WorklistOpen.organization == user.organization, WorklistOpen.user_id == user.id))).all())
    for row in rows:
        row["last_opened"] = by_key.get(record_key(row))


def matches_advanced(row, filters, today):
    def includes(keyword, *values):
        folded = keyword.casefold()
        return not folded or any(folded in value.casefold() for value in values if value)

    if filters.group_key and row.get("group_key") != filters.group_key:
        return False
    if filters.priority and (row.get("priority") or "unset") != filters.priority:
        return False
    patient = row["patient"] or {}
    if not includes(filters.patient_name, patient.get("name")) or not includes(
        filters.patient_id, patient.get("localRef"), *(item["value"] for item in row["mrns"])
    ):
        return False
    if filters.sex and filters.sex != (patient.get("sex") or "missing"):
        return False
    if not includes(filters.specimen, *row["specimen_terms"]) or not includes(filters.slide_id, *row["slide_ids"]):
        return False
    if filters.slide_state and filters.slide_state not in row["slide_state"]:
        return False
    if filters.lis_data and row["lis_data"] != filters.lis_data:
        return False
    if not includes(filters.lis_status, row["lis_status"]):
        return False
    age = row["age"]
    if filters.age_data and filters.age_data != ("missing" if age is None else "available"):
        return False
    if filters.age_min is not None and (age is None or age < filters.age_min):
        return False
    if filters.age_max is not None and (age is None or age > filters.age_max):
        return False
    if filters.date_from or filters.date_to:
        selected = calendar_date(row.get(filters.date_field))
        if selected is None or filters.date_from and selected < filters.date_from or filters.date_to and selected > filters.date_to:
            return False
    opened = calendar_date(row["last_opened"])
    if filters.opened == "unopened":
        return opened is None
    if filters.opened:
        days = {"today": 0, "last_2_days": 1, "last_7_days": 6}[filters.opened]
        return opened is not None and today - timedelta(days=days) <= opened <= today
    return True


def row_fields(row):
    keys = ("mrns", "collection_date", "age", "slide_state", "slide_count", "has_storage", "lis_status", "lis_data",
            "lis_sources", "request_count", "review_note", "last_opened")
    return {key: row.get(key) for key in keys}


def assignment_workload(rows, staff):
    people = {item.id: item.display_name for item in staff}
    totals = {}
    for row in rows:
        key = row["assigned_to"]
        workload = totals.setdefault(key, {
            "assigned_to": key, "name": people.get(key, "Unassigned"), "cases": 0, "open_cases": 0,
            "in_review": 0, "completed": 0, "slides": 0, "frozen": 0,
        })
        workload["cases"] += 1
        workload["open_cases"] += row["status"] != "reviewed"
        workload["in_review"] += row["status"] == "in_review"
        workload["completed"] += row["status"] == "reviewed"
        workload["slides"] += row["workload_slides"]
        workload["frozen"] += row.get("priority") == "frozen"
    return sorted(totals.values(), key=lambda row: (row["assigned_to"] is None, row["name"].casefold()))
