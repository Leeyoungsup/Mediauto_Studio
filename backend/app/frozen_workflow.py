"""Versioned preliminary frozen-section communication and scoped OR receipts."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth import require_roles
from app.case_activity import attempt_id, record_activity
from app.clinical import ClinicalInput, Organization, Reason, RegistrationKey, Session, add_event, find, write
from app.integration_service import now
from app.models import (
    AuthUser, Case, CaseReport, FrozenCallback, FrozenPublication, FrozenReceipt, FrozenRecipient, ReportRevision,
)

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Frozen section and OR"])
LAB_ROLES = ("admin", "doctor")
OR_ROLES = ("admin", "viewer")
Findings = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Margins = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class RecipientUpdate(ClinicalInput):
    active: bool
    reason: Reason


class PublicationInput(ClinicalInput):
    findings: Findings
    margins: Margins | None = None
    corrects_id: UUID | None = None
    correction_reason: Reason | None = None


class Confirmation(ClinicalInput):
    outcome: Literal["acknowledged", "failed"]
    read_back: bool = False
    reason: Reason | None = None


class CallbackInput(ClinicalInput):
    publication_id: UUID
    recipient_id: UUID
    outcome: Literal["reached_read_back", "no_answer", "failed"]
    note: Reason | None = None
    read_back: bool = False


def case_scope(model, case):
    return model.organization == case.organization, model.case_id == case.id


def require_frozen(case):
    if case.priority != "frozen":
        raise HTTPException(409, "Set this case to Frozen priority before sharing an OR result.")


def publication_view(row):
    if row is None:
        return None
    return {"id": row.id, "sequence": row.sequence, "findings": row.findings, "margins": row.margins,
            "corrects_id": row.corrects_id, "correction_reason": row.correction_reason,
            "published_at": row.created_at, "status": "preliminary"}


def receipt_view(row):
    if row is None:
        return None
    return {"id": row.id, "recipient_id": row.recipient_id, "status": row.status,
            "reason": row.reason, "responded_at": row.responded_at}


def callback_view(row):
    return {"id": row.id, "publication_id": row.publication_id, "recipient_id": row.recipient_id,
            "outcome": row.outcome, "note": row.note, "recorded_at": row.created_at, "recorded_by": row.created_by}


async def latest_publication(session, case):
    return await session.scalar(select(FrozenPublication).where(*case_scope(FrozenPublication, case))
                                .order_by(FrozenPublication.sequence.desc()).limit(1))


async def enrolled(session, case):
    return (await session.execute(select(FrozenRecipient, AuthUser).join(AuthUser, AuthUser.id == FrozenRecipient.user_id)
                                 .where(*case_scope(FrozenRecipient, case)).order_by(AuthUser.display_name, AuthUser.id))).all()


def eligible(account):
    return account.active and account.role == "viewer"


async def add_receipt(session, publication, recipient_id, actor):
    await session.execute(insert(FrozenReceipt).values(
        organization=publication.organization, case_id=publication.case_id, publication_id=publication.id,
        recipient_id=recipient_id, status="pending", created_by=str(actor.id),
    ).on_conflict_do_nothing())


async def final_state(session, case):
    scope = (CaseReport.organization == case.organization, CaseReport.case_id == case.id)
    report = (await session.execute(select(ReportRevision.status, ReportRevision.version)
        .join(CaseReport, (CaseReport.organization == ReportRevision.organization) & (CaseReport.id == ReportRevision.report_id))
        .where(*scope, CaseReport.version == ReportRevision.version))).one_or_none()
    return {"status": report.status, "version": report.version} if report else None


@router.get("/cases/{case_id}/frozen")
async def frozen_summary(organization: Organization, case_id: UUID, response: Response, session: Session):
    user = session.info["user"]
    require_roles(user, LAB_ROLES)
    case = await find(session, Case, organization, case_id)
    response.headers["Cache-Control"] = "private, no-store"
    deliveries = (await session.scalars(select(FrozenReceipt).where(*case_scope(FrozenReceipt, case))
                    .order_by(FrozenReceipt.created_at, FrozenReceipt.id))).all()
    callbacks = (await session.scalars(select(FrozenCallback).where(*case_scope(FrozenCallback, case))
                   .order_by(FrozenCallback.created_at.desc(), FrozenCallback.id))).all()
    publications = (await session.scalars(select(FrozenPublication).where(*case_scope(FrozenPublication, case))
                       .order_by(FrozenPublication.sequence.desc()))).all()
    roster = await enrolled(session, case)
    candidates = (await session.scalars(select(AuthUser).where(
        AuthUser.organization == organization, AuthUser.role == "viewer", AuthUser.active.is_(True),
    ).order_by(AuthUser.display_name, AuthUser.id))).all() if user.role == "admin" else []
    by_publication = {}
    for record in deliveries:
        by_publication.setdefault(record.publication_id, []).append(receipt_view(record))
    by_callback = {}
    actor_ids = {UUID(row.created_by) for row in callbacks}
    names = {str(account.id): account.display_name for account in await session.scalars(select(AuthUser)
             .where(AuthUser.organization == organization, AuthUser.id.in_(actor_ids)))}
    for record in callbacks:
        view = callback_view(record)
        view["recorded_by"] = names.get(record.created_by, "Former User")
        by_callback.setdefault(record.publication_id, []).append(view)
    return {
        "publications": [{**publication_view(row), "receipts": by_publication.get(row.id, []),
                          "callbacks": by_callback.get(row.id, [])} for row in publications],
        "recipients": [{"id": account.id, "name": account.display_name, "active": grant.active and eligible(account)}
                       for grant, account in roster],
        "candidates": [{"id": account.id, "name": account.display_name, "username": account.username} for account in candidates],
        "can_manage": user.role == "admin" and case.priority == "frozen",
        "can_publish": user.role == "doctor" and case.assigned_to == user.id and case.priority == "frozen",
        "final_report": await final_state(session, case),
    }


@router.put("/cases/{case_id}/frozen/recipients/{recipient_id}")
async def change_frozen_recipient(organization: Organization, case_id: UUID, recipient_id: UUID,
                                  data: RecipientUpdate, session: Session):
    user = session.info["user"]
    async with write(session, ("admin",)):
        case = await find(session, Case, organization, case_id, lock=True)
        if data.active:
            require_frozen(case)
        account = await session.scalar(select(AuthUser).where(
            AuthUser.organization == organization, AuthUser.id == recipient_id,
        ))
        if account is None or (data.active and not eligible(account)):
            raise HTTPException(404, "Choose an active OR viewer from this organization.")
        row = await session.scalar(select(FrozenRecipient).where(
            *case_scope(FrozenRecipient, case), FrozenRecipient.user_id == recipient_id,
        ))
        if row is None and not data.active:
            raise HTTPException(404, "OR recipient not found in this case.")
        if row is not None and row.active == data.active:
            return {"ok": True}
        before = {"active": row.active} if row else {}
        if row is None:
            row = FrozenRecipient(organization=organization, case_id=case_id, user_id=recipient_id,
                                  active=True, created_by=str(user.id))
            session.add(row)
            await session.flush()
        else:
            row.active = data.active
            row.version += 1
        if data.active and (current := await latest_publication(session, case)):
            await add_receipt(session, current, recipient_id, user)
        add_event(session, row, "or_recipient_granted" if data.active else "or_recipient_revoked", before,
                  {"recipient_id": str(recipient_id), "active": data.active}, data.reason, source="ims")
    return {"ok": True}


@router.post("/cases/{case_id}/frozen/publications", status_code=201)
async def publish_frozen(organization: Organization, case_id: UUID, data: PublicationInput,
                         key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ("doctor",)):
        case = await find(session, Case, organization, case_id, lock=True)
        existing = await session.scalar(select(FrozenPublication).where(
            *case_scope(FrozenPublication, case), FrozenPublication.created_by == str(user.id), FrozenPublication.request_key == key,
        ))
        if existing is not None:
            if any(getattr(existing, field) != value for field, value in data.model_dump().items()):
                raise HTTPException(409, "This publication key was used for a different result.")
            return publication_view(existing)
        require_frozen(case)
        previous = await latest_publication(session, case)
        if data.corrects_id != (previous.id if previous else None):
            raise HTTPException(409, "The published result changed. Reload it before sharing a correction.")
        if bool(previous) != bool(data.correction_reason):
            raise HTTPException(422, "Enter a correction reason for a new version of a published result.")
        if previous and (previous.findings, previous.margins) == (data.findings, data.margins):
            raise HTTPException(422, "Change the findings or margin assessment before publishing a correction.")
        recipients = [account.id for grant, account in await enrolled(session, case) if grant.active and eligible(account)]
        if not recipients:
            raise HTTPException(409, "An administrator must authorize at least one OR recipient before publication.")
        row = FrozenPublication(organization=organization, case_id=case.id, sequence=previous.sequence + 1 if previous else 1,
                               request_key=key, created_by=str(user.id), **data.model_dump())
        session.add(row)
        await session.flush()
        for recipient in recipients:
            await add_receipt(session, row, recipient, user)
        add_event(session, row, "frozen_result_corrected" if previous else "frozen_result_published",
                  {"sequence": previous.sequence} if previous else {},
                  {"sequence": row.sequence, "recipient_count": len(recipients), "status": "preliminary",
                   "corrects_id": str(previous.id) if previous else None}, data.correction_reason, source="ims")
        return publication_view(row)


def recipient_access(user):
    return select(FrozenRecipient.case_id).where(
        FrozenRecipient.organization == user.organization, FrozenRecipient.user_id == user.id,
        FrozenRecipient.active.is_(True),
    )


async def or_case(session, user, case_id, lock=False):
    require_roles(user, OR_ROLES)
    query = select(Case).where(Case.organization == user.organization, Case.id == case_id, Case.priority == "frozen")
    if user.role == "viewer":
        query = query.where(Case.id.in_(recipient_access(user)))
    case = await session.scalar(query.with_for_update() if lock else query)
    if case is None:
        raise HTTPException(404, "OR case not found.")
    if lock and user.role == "viewer" and await session.scalar(recipient_access(user).where(
        FrozenRecipient.case_id == case.id,
    )) is None:
        raise HTTPException(404, "OR case not found.")
    return case


async def receipt_for(session, case, publication_id, recipient_id):
    return await session.scalar(select(FrozenReceipt).where(
        *case_scope(FrozenReceipt, case), FrozenReceipt.publication_id == publication_id,
        FrozenReceipt.recipient_id == recipient_id,
    ))


@router.get("/or")
async def or_queue(organization: Organization, response: Response, session: Session):
    user = session.info["user"]
    require_roles(user, OR_ROLES)
    response.headers["Cache-Control"] = "private, no-store"
    query = select(Case).where(Case.organization == organization, Case.priority == "frozen")
    if user.role == "viewer":
        query = query.where(Case.id.in_(recipient_access(user)))
    recent = select(FrozenPublication.case_id, FrozenPublication.id, FrozenPublication.sequence, FrozenPublication.created_at).where(
        FrozenPublication.organization == organization,
    ).distinct(FrozenPublication.case_id).order_by(FrozenPublication.case_id, FrozenPublication.sequence.desc()).subquery()
    scoped = query.subquery()
    rows = (await session.execute(select(scoped.c.id, scoped.c.case_number, recent.c.sequence,
                                          recent.c.created_at.label("published_at"), FrozenReceipt.status)
            .select_from(scoped).outerjoin(recent, recent.c.case_id == scoped.c.id)
            .outerjoin(FrozenReceipt, (FrozenReceipt.organization == organization)
                & (FrozenReceipt.publication_id == recent.c.id) & (FrozenReceipt.recipient_id == user.id))
            .order_by(recent.c.created_at.desc().nullslast(), scoped.c.case_number))).mappings().all()
    return {"cases": [dict(row) for row in rows], "can_acknowledge": user.role == "viewer"}


@router.get("/or/cases/{case_id}")
async def or_result(organization: Organization, case_id: UUID, request: Request, response: Response, session: Session):
    user = session.info["user"]
    case = await or_case(session, user, case_id)
    response.headers["Cache-Control"] = "private, no-store"
    publication = await latest_publication(session, case)
    receipt = await receipt_for(session, case, publication.id, user.id) if publication and user.role == "viewer" else None
    if publication and user.role == "viewer" and receipt is None:
        raise HTTPException(404, "This result has not been shared with you.")
    if publication:
        await record_activity(session, user, case.id, "or_result_opened", "frozen_result",
                              publication.id, attempt_id(request))
    callback = None
    if publication:
        query = select(FrozenCallback.outcome, FrozenCallback.created_at.label("recorded_at")).where(
            *case_scope(FrozenCallback, case), FrozenCallback.publication_id == publication.id,
        )
        if user.role == "viewer":
            query = query.where(FrozenCallback.recipient_id == user.id)
        callback = (await session.execute(query.order_by(FrozenCallback.created_at.desc(), FrozenCallback.id).limit(1))).mappings().one_or_none()
    result = {"case_number": case.case_number, "publication": publication_view(publication),
              "receipt": receipt_view(receipt), "callback": dict(callback) if callback else None,
              "final_report": await final_state(session, case)}
    if publication:
        await session.commit()
    return result


@router.post("/or/cases/{case_id}/results/{publication_id}/confirmation")
async def confirm_frozen(organization: Organization, case_id: UUID, publication_id: UUID,
                         data: Confirmation, session: Session):
    user = session.info["user"]
    async with write(session, ("viewer",)):
        case = await or_case(session, user, case_id, lock=True)
        publication = await latest_publication(session, case)
        if publication is None or publication.id != publication_id:
            raise HTTPException(409, "The OR result was updated. Review the latest version before confirming.")
        row = await receipt_for(session, case, publication.id, user.id)
        if row is None:
            raise HTTPException(404, "This result has not been shared with you.")
        if data.outcome == "acknowledged" and (not data.read_back or data.reason):
            raise HTTPException(422, "Confirm that you read the current result before acknowledging it.")
        if data.outcome == "failed" and (not data.reason or data.read_back):
            raise HTTPException(422, "Enter a reason for the confirmation issue.")
        if (row.status, row.reason) == (data.outcome, data.reason):
            return receipt_view(row)
        if row.status == "acknowledged":
            raise HTTPException(409, "This result has already been acknowledged.")
        before = {"status": row.status, "reason": row.reason}
        row.status, row.reason, row.responded_at = data.outcome, data.reason, now()
        row.version += 1
        add_event(session, row, "or_result_acknowledged" if data.outcome == "acknowledged" else "or_confirmation_failed",
                  before, {"status": row.status, "sequence": publication.sequence, "publication_id": str(publication.id)},
                  data.reason, source="ims")
        return receipt_view(row)


@router.post("/cases/{case_id}/frozen/callbacks", status_code=201)
async def record_frozen_callback(organization: Organization, case_id: UUID, data: CallbackInput,
                                 key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ("doctor",)):
        case = await find(session, Case, organization, case_id, lock=True)
        existing = await session.scalar(select(FrozenCallback).where(
            *case_scope(FrozenCallback, case), FrozenCallback.created_by == str(user.id), FrozenCallback.request_key == key,
        ))
        fields = data.model_dump(exclude={"read_back"})
        if (data.outcome == "reached_read_back") != data.read_back:
            raise HTTPException(422, "Confirm read-back only for a reached call.")
        if data.outcome != "reached_read_back" and not data.note:
            raise HTTPException(422, "Enter a note for the unsuccessful callback.")
        if existing is not None:
            if any(getattr(existing, field) != value for field, value in fields.items()):
                raise HTTPException(409, "This callback key was used for a different call.")
            return callback_view(existing)
        require_frozen(case)
        publication = await latest_publication(session, case)
        if publication is None or publication.id != data.publication_id:
            raise HTTPException(409, "The published result changed. Select the current version before logging a callback.")
        members = {account.id for grant, account in await enrolled(session, case) if grant.active and eligible(account)}
        if data.recipient_id not in members or await receipt_for(session, case, publication.id, data.recipient_id) is None:
            raise HTTPException(404, "Select an authorized recipient for this result.")
        row = FrozenCallback(organization=organization, case_id=case.id, request_key=key, created_by=str(user.id), **fields)
        session.add(row)
        await session.flush()
        add_event(session, row, "frozen_callback_recorded", {},
                  {"outcome": row.outcome, "sequence": publication.sequence, "publication_id": str(publication.id),
                   "recipient_id": str(row.recipient_id)}, source="ims")
        return callback_view(row)
