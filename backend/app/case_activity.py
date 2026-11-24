"""Record case access and failed operations without persisting request contents."""

import logging
from uuid import UUID, uuid4

from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from sqlalchemy import literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.clinical import case_visibility
from app.models import Case, CaseActivity, CaseRequest, Slide, SlideScan, Specimen, SpecimenBlock

logger = logging.getLogger(__name__)


def attempt_id(request):
    try:
        return UUID(request.headers.get("X-Audit-Attempt", ""))
    except ValueError:
        return uuid4()


async def record_activity(session, user, case_id, action, entity, target_id, attempt, result="success", status_code=None):
    await session.execute(insert(CaseActivity).values(
        organization=user.organization, actor_id=user.id, case_id=case_id, action=action,
        entity=entity, target_id=target_id, attempt_id=attempt, result=result, status_code=status_code,
    ).on_conflict_do_nothing(constraint="uq_case_activity_attempt"))


# Exact operation names prevent per-tile, background polling and unrelated errors from filling the audit.
CASE_OPERATIONS = {
    "change_frozen_recipient": ("or_recipient_changed", "or_recipient"),
    "publish_frozen": ("frozen_result_published", "frozen_result"),
    "or_result": ("or_result_opened", "frozen_result"),
    "confirm_frozen": ("or_confirmation_attempted", "or_confirmation"),
    "record_frozen_callback": ("frozen_callback_recorded", "frozen_callback"),
    "clinical_open": ("case_opened", "case"),
    "worklist_case": ("case_opened", "case"),
    "assign_case": ("assignment_change", "case"),
    "classify_case": ("classification_changed", "case"),
    "review_case": ("review_change", "case"),
    "link_case_patient": ("patient_id_changed", "case"),
    "link_patient_match": ("patient_id_changed", "case"),
    "patient_lookup": ("patient_lookup", "case"),
    "confirm_patient": ("patient_confirmation", "case"),
    "manual_patient": ("manual_patient_entry", "case"),
    "save_draft": ("report_draft_saved", "report"),
    "act_report": ("report_action", "report"),
    "send_report": ("report_delivery_queued", "report"),
    "retry_report": ("report_delivery_requeued", "report"),
    "post_note": ("note_created", "note"),
    "create_request": ("request_created", "request"),
    "create_manual": ("patient_history_recorded", "clinical_record"),
    "list_history": ("patient_history_opened", "clinical_record"),
    "get_document": ("patient_history_opened", "clinical_record"),
    "upload": ("attachment_registered", "attachment"),
    "preview": ("attachment_opened", "attachment"),
    "download": ("attachment_downloaded", "attachment"),
}
SCAN_OPERATIONS = {
    "metadata": ("scan_viewed", "scan"),
    "export_roi": ("roi_capture_exported", "annotation"),
    "save_lymph_count": ("lymph_node_count_saved", "lymph_node_count"),
    "create_annotation": ("annotation_registered", "annotation"),
    "edit_annotation": ("annotation_updated", "annotation"),
    "delete_annotation": ("annotation_deleted", "annotation"),
    "save_position": ("position_saved", "scan"),
    "check_scan": ("scan_structure_checked", "scan"),
    "edit_scan": ("scan_edited", "scan"),
    "assess_scan": ("scan_qc_recorded", "scan"),
    "replace_scan": ("replacement_registered", "scan"),
    "save_label": ("scan_label_uploaded", "scan"),
    "scan_ocr": ("label_ocr_generated", "scan"),
}
SPECIMEN_OPERATIONS = {
    "edit_specimen": ("specimen_edited", "specimen", "specimen_id"),
    "change_collection": ("collection_date_changed", "specimen", "record_id"),
    "create_block": ("block_registered", "block", "specimen_id"),
    "edit_block": ("block_edited", "block", "block_id"),
    "edit_slide": ("slide_edited", "slide", "slide_id"),
}


def path_uuid(params, field):
    try:
        return UUID(str(params[field]))
    except (KeyError, ValueError):
        return None


def error_scope(request):
    params = request.path_params
    name = getattr(request.scope.get("endpoint"), "__name__", "")
    if name in CASE_OPERATIONS and (case := path_uuid(params, "case_id") or path_uuid(params, "record_id")):
        action, entity = CASE_OPERATIONS[name]
        target = path_uuid(params, "attachment_id") or path_uuid(params, "publication_id") or path_uuid(params, "recipient_id") or case
        return case, action, entity, target
    if name in SCAN_OPERATIONS and params.get("source", "clinical") == "clinical" and (scan := path_uuid(params, "scan_id")):
        action, entity = SCAN_OPERATIONS[name]
        cases = select(Specimen.case_id).join(Slide, Slide.specimen_id == Specimen.id).join(SlideScan, SlideScan.slide_id == Slide.id)
        return cases.where(SlideScan.id == scan), action, entity, path_uuid(params, "annotation_id") or scan
    if name in SPECIMEN_OPERATIONS:
        action, entity, field = SPECIMEN_OPERATIONS[name]
        if not (target := path_uuid(params, field)):
            return None
        cases = select(Specimen.case_id)
        if field == "block_id":
            cases = cases.join(SpecimenBlock, SpecimenBlock.specimen_id == Specimen.id).where(SpecimenBlock.id == target)
        elif field == "slide_id":
            cases = cases.join(Slide, Slide.specimen_id == Specimen.id).where(Slide.id == target)
        else:
            cases = cases.where(Specimen.id == target)
        return cases, action, entity, target
    if name == "request_wsi" and (resolved := getattr(request.state, "case_activity_wsi", None)):
        case, scan = resolved
        return case, "scan_viewed", "scan", scan
    if name in ("change_request", "request_wsi") and (target := path_uuid(params, "request_id")):
        cases = select(CaseRequest.case_id).where(CaseRequest.id == target)
        return cases, "scan_viewed" if name == "request_wsi" else "request_change", "request", target
    return None


async def log_error(request, status):
    user = getattr(request.state, "auth_user", None)
    if (not user or status < 400 or status == 499
            or request.path_params.get("organization", user.organization) != user.organization):
        return
    scope = error_scope(request)
    if scope is None:
        return
    case, action, entity, target = scope
    where = Case.id == case if isinstance(case, UUID) else Case.id.in_(case)
    try:
        # The failed operation has its own rollback. This transaction only records the attempt.
        async with AsyncSession(request.app.state.engine) as session, session.begin():
            visibility = case_visibility(Case, user)
            accessible = literal(True) if visibility is True else visibility
            row = (await session.execute(select(Case.id, accessible)
                   .where(Case.organization == user.organization, where))).one_or_none()
            if row:
                result = "denied" if status == 403 or (status == 404 and not row[1]) else "failed"
                await record_activity(session, user, row.id, action, entity, target, attempt_id(request), result, status)
    except SQLAlchemyError:
        logger.warning("Unable to persist a case activity failure event.")


async def case_http_exception(request, exc):
    await log_error(request, exc.status_code)
    return await http_exception_handler(request, exc)


async def case_validation_exception(request, exc):
    await log_error(request, 422)
    return await request_validation_exception_handler(request, exc)
