"""Query case-scoped runtime activity and the existing clinical audit trail."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import Integer, String, and_, case, cast, literal, or_, select, tuple_, union_all
from sqlalchemy.dialects.postgresql import JSONB

from app.auth import require_roles
from app.clinical import ClinicalInput, Organization, Session, find
from app.intake import source_id
from app.models import (AuthUser, Case, CaseActivity, CaseAttachment, CaseNote, CaseRequest, ClinicalEvent,
                        PatientHistoryRecord, Slide, SlideScan, Specimen, SpecimenBlock, ViewerAnnotation)

router = APIRouter(prefix="/api/clinical/{organization}/cases/{case_id}/logs", tags=["Case logs"])
ROLE_SCOPE = ("admin", "doctor")
PAGE_SIZE = 30
ENTITY_NAMES = {
    "frozen_publications": "frozen_result", "frozen_recipients": "or_recipient",
    "frozen_receipts": "or_confirmation", "frozen_callbacks": "frozen_callback",
    "cases": "case", "case_reports": "report", "report_transmissions": "report_delivery", "specimens": "specimen", "specimen_blocks": "block", "slides": "slide",
    "analysis_runs": "analysis_run", "ihc_reviews": "ihc_review",
    "lymph_node_counts": "lymph_node_count", "slide_scans": "scan", "viewer_annotations": "annotation", "case_attachments": "attachment",
    "case_requests": "request", "case_notes": "note", "patient_history_records": "clinical_record",
}


class Filters(ClinicalInput):
    actor: Annotated[str, Query(max_length=80)] | None = None
    action: Annotated[str, Query(max_length=40)] | None = None
    entity: Annotated[str, Query(max_length=24)] | None = None
    target_id: UUID | None = None
    result: Literal["success", "failed", "denied"] | None = None
    before_at: AwareDatetime | None = None
    before_id: UUID | None = None


def in_scope(record_type, query):
    return and_(ClinicalEvent.record_type == record_type, ClinicalEvent.record_id.in_(query))


async def audit_rows(session, organization, case_id):
    specimens = select(Specimen.id).where(Specimen.organization == organization, Specimen.case_id == case_id)
    # A previously linked slide may carry history from another case. Only an explicit case ID
    # can attribute its old records after a transfer.
    relocated = select(ClinicalEvent.record_id).where(
        ClinicalEvent.organization == organization, ClinicalEvent.record_type == "slides",
        ClinicalEvent.action == "specimen_id_changed", ClinicalEvent.before["specimen_id"].astext.is_not(None),
    )
    slides = select(Slide.id).where(Slide.organization == organization, Slide.specimen_id.in_(specimens),
                                   Slide.id.not_in(relocated))
    scans = (SlideScan.organization == organization, SlideScan.slide_id.in_(slides))
    scan_files = (await session.execute(select(SlideScan.storage_key, SlideScan.size_bytes, SlideScan.modified_ns)
                                      .where(*scans))).all()
    fingerprints = [UUID(source_id(*scan)) for scan in scan_files]
    legacy = or_(
        and_(ClinicalEvent.record_type == "cases", ClinicalEvent.record_id == case_id),
        in_scope("specimens", specimens),
        in_scope("specimen_blocks", select(SpecimenBlock.id).where(
            SpecimenBlock.organization == organization, SpecimenBlock.specimen_id.in_(specimens))),
        in_scope("slides", slides),
        in_scope("slide_scans", select(SlideScan.id).where(*scans)),
        in_scope("viewer_annotations", select(ViewerAnnotation.id).where(
            ViewerAnnotation.organization == organization, ViewerAnnotation.scan_key.in_(fingerprints), ViewerAnnotation.kind != "bookmark")),
        *(in_scope(model.__tablename__, select(model.id).where(model.organization == organization, model.case_id == case_id))
          for model in (CaseAttachment, CaseNote, CaseRequest, PatientHistoryRecord)),
    )
    mutation = ClinicalEvent
    failed = or_(
        mutation.action.in_(("or_confirmation_failed", "analysis_failed")),
        and_(mutation.action == "frozen_callback_recorded", mutation.after["outcome"].astext.in_(("failed", "no_answer"))),
        and_(mutation.record_type == "case_requests", mutation.after["status"].astext == "failed"),
        and_(mutation.record_type == "report_transmissions", mutation.after["status"].astext == "failed"),
        and_(mutation.action == "scan_structure_checked", mutation.after["error"].astext.is_not(None)),
    )
    changes = select(
        mutation.id, mutation.occurred_at, mutation.actor, mutation.action,
        case(ENTITY_NAMES, value=mutation.record_type, else_=mutation.record_type).label("entity"),
        mutation.record_id.label("target_id"), case((failed, "failed"), else_="success").label("result"),
        literal(None, Integer).label("status_code"), mutation.before, mutation.after, mutation.reason,
    ).where(mutation.organization == organization,
            or_(mutation.case_id == case_id, and_(mutation.case_id.is_(None), legacy)))
    runtime = CaseActivity
    access = select(
        runtime.id, runtime.occurred_at, cast(runtime.actor_id, String).label("actor"), runtime.action,
        runtime.entity, runtime.target_id, runtime.result, runtime.status_code,
        literal({}, JSONB).label("before"), literal({}, JSONB).label("after"), literal(None, String).label("reason"),
    ).where(runtime.organization == organization, runtime.case_id == case_id)
    return union_all(changes, access).cte("case_log")


@router.get("")
async def logs(organization: Organization, case_id: UUID, session: Session, filters: Annotated[Filters, Query()]):
    require_roles(session.info["user"], ROLE_SCOPE)
    await find(session, Case, organization, case_id)
    if bool(filters.before_at) != bool(filters.before_id):
        raise HTTPException(422, "Provide both values of the log cursor.")
    rows = await audit_rows(session, organization, case_id)
    account = AuthUser
    actor_name = account.display_name.label("actor_name")
    base = rows.outerjoin(account, and_(account.organization == organization, cast(account.id, String) == rows.c.actor))
    q = select(rows, actor_name).select_from(base)
    for name in ("actor", "action", "entity", "target_id", "result"):
        value = getattr(filters, name)
        if value is not None:
            q = q.where(rows.c[name] == value)
    if filters.before_at:
        q = q.where(tuple_(rows.c.occurred_at, rows.c.id) < tuple_(filters.before_at, filters.before_id))
    found = (await session.execute(q.order_by(rows.c.occurred_at.desc(), rows.c.id.desc()).limit(PAGE_SIZE + 1))).mappings().all()
    choices = (await session.execute(select(rows.c.actor, actor_name, rows.c.action, rows.c.entity)
                                    .select_from(base).distinct())).mappings().all()
    return {
        "rows": [dict(row) for row in found[:PAGE_SIZE]],
        "has_more": len(found) > PAGE_SIZE,
        "actors": sorted({row.actor: row.actor_name or row.actor for row in choices}.items(), key=lambda row: (row[1], row[0])),
        "actions": sorted({row.action for row in choices}),
        "entities": sorted({row.entity for row in choices}),
    }
