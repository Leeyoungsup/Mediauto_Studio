"""Local case requests, immutable completion references, and an in-app inbox."""

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field, StringConstraints, model_validator
from sqlalchemy import func, or_, select, true

from app.auth import CurrentUser, require_roles
from app.clinical import (ClinicalInput, Organization, RegistrationKey, Session,
                          add_event, find, require_version, write)
from app.models import AuthUser, Case, CaseRequest, ClinicalEvent, RequestNotification, Slide, SlideScan, Specimen
from app.pdl1 import results_for_display, snapshot_folder
from app.wsi import PRIVATE, STAGE_DOWNSAMPLES, scan_response, verified_scan_path

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Case requests"])
Kind = Literal["ai", "consult"]
Action = Literal["assign", "start", "complete", "fail", "retry", "cancel"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
SnapshotId = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
ROLES = ("admin", "doctor")
WSI_STATUSES = ("assigned", "in_progress")


class CreateRequest(ClinicalInput):
    kind: Kind
    question: Question
    scan_id: UUID | None = None
    assignee_id: UUID | None = None

    @model_validator(mode="after")
    def scan_for_ai(self):
        if self.kind == "ai" and self.scan_id is None:
            raise ValueError("AI requests require a registered scan")
        return self


class ChangeRequest(ClinicalInput):
    version: Annotated[int, Field(ge=1)]
    action: Action
    assignee_id: UUID | None = None
    note: Text = ""
    snapshot_id: SnapshotId | None = None

    @model_validator(mode="after")
    def check_payload(self):
        if (self.action == "assign") != (self.assignee_id is not None):
            raise ValueError("Assignment requires an assignee")
        if self.snapshot_id and self.action != "complete":
            raise ValueError("Snapshots are attached on completion")
        if self.note and self.action not in ("complete", "fail"):
            raise ValueError("Notes are accepted for completion and failure")
        return self


def request_access(user):
    if user.role == "admin":
        return true()
    return or_(Case.assigned_to == user.id, CaseRequest.requested_by == user.id, CaseRequest.assigned_to == user.id)


async def request_context(session, user, request_id, lock=False):
    require_roles(user, ROLES)
    query = select(CaseRequest, Case).join(Case, Case.id == CaseRequest.case_id).where(
        CaseRequest.organization == user.organization, CaseRequest.id == request_id, request_access(user))
    if lock:
        query = query.with_for_update(of=(Case, CaseRequest))
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise HTTPException(404, "요청을 찾을 수 없습니다.")
    return row


async def case_scan(session, case, scan_id):
    if scan_id is None:
        return None
    scan = (await session.execute(select(SlideScan, Slide.slide_number, Slide.stain)
        .join(Slide, SlideScan.slide_id == Slide.id).join(Specimen, Slide.specimen_id == Specimen.id)
        .where(SlideScan.id == scan_id, SlideScan.organization == case.organization,
               SlideScan.status == "registered", Specimen.case_id == case.id))).one_or_none()
    if scan is None:
        raise HTTPException(404, "케이스에 연결된 스캔을 찾을 수 없습니다.")
    return scan


async def eligible(session, user, kind, assignee_id=None):
    roles = ROLES if kind == "ai" else ("doctor",)
    query = select(AuthUser).where(AuthUser.organization == user.organization,
                                  AuthUser.active.is_(True), AuthUser.role.in_(roles))
    if assignee_id is not None:
        account = await session.scalar(query.where(AuthUser.id == assignee_id).with_for_update(read=True))
        if account is None:
            raise HTTPException(422, "기관의 활성 담당자 계정을 선택하세요.")
        return account.id
    return [{"id": account.id, "name": account.display_name, "username": account.username}
            for account in await session.scalars(query.order_by(AuthUser.display_name, AuthUser.username))]


def can_manage(row, case, user):
    return user.role == "admin" or (case.assigned_to == user.id and row.requested_by == user.id)


def allowed_actions(row, case, user):
    manages = can_manage(row, case, user)
    handles = row.assigned_to == user.id
    actions = []
    if manages and row.status in ("open", "assigned"):
        actions.append("assign")
    if handles and row.status == "assigned":
        actions.append("start")
    if handles and row.status == "in_progress":
        actions.extend(("complete", "fail"))
    if manages and row.status == "failed":
        actions.append("retry")
    if manages and row.status in ("open", "assigned", "in_progress", "failed"):
        actions.append("cancel")
    return actions


def state(row):
    return {"status": row.status, "assigned_to": str(row.assigned_to) if row.assigned_to else None,
            "case_id": str(row.case_id), "kind": row.kind, "scan_id": str(row.scan_id) if row.scan_id else None,
            "result_note": row.result_note, "snapshot_id": row.snapshot["id"] if row.snapshot else None}


def record_change(session, row, actor, action, before, previous=None):
    add_event(session, row, action, before, state(row), source="ims")
    recipients = {row.requested_by, row.assigned_to, previous} - {None, actor.id}
    for recipient in recipients:
        label = "assignment_removed" if previous == recipient and recipient != row.assigned_to else action
        session.add(RequestNotification(organization=row.organization, request_id=row.id, recipient_id=recipient,
                                        event_version=row.version, action=label))


async def show_requests(session, rows, user):
    account_ids = {ident for row in rows for ident in (row.requested_by, row.assigned_to) if ident}
    names = dict((await session.execute(select(AuthUser.id, AuthUser.display_name).where(
        AuthUser.organization == user.organization, AuthUser.id.in_(account_ids)))).all())
    return [{"id": row.id, "kind": row.kind, "status": row.status, "question": row.question, "version": row.version,
             "requested_by": names.get(row.requested_by), "assigned_to": row.assigned_to,
             "assignee_name": names.get(row.assigned_to), "scan_id": row.scan_id,
             "result_note": row.result_note, "snapshot": row.snapshot, "updated_at": row.updated_at} for row in rows]


@router.get("/cases/{case_id}/requests")
async def list_requests(organization: Organization, case_id: UUID, user: CurrentUser, session: Session):
    require_roles(user, ROLES)
    await find(session, Case, organization, case_id)
    rows = (await session.scalars(select(CaseRequest).where(
        CaseRequest.organization == organization, CaseRequest.case_id == case_id)
        .order_by(CaseRequest.created_at.desc(), CaseRequest.id))).all()
    return {"requests": await show_requests(session, rows, user),
            "candidates": {kind: await eligible(session, user, kind) for kind in ("ai", "consult")}}


@router.post("/cases/{case_id}/requests", status_code=201)
async def create_request(organization: Organization, case_id: UUID, data: CreateRequest,
                         key: RegistrationKey, user: CurrentUser, session: Session):
    payload = {**data.model_dump(mode="json"), "case_id": str(case_id)}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    async with write(session, ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        existing = await session.scalar(select(CaseRequest).where(
            CaseRequest.organization == organization, CaseRequest.requested_by == user.id, CaseRequest.request_key == key))
        if existing is not None:
            if existing.request_hash != digest:
                raise HTTPException(409, "같은 요청 키를 다른 내용에 사용할 수 없습니다.")
            return (await show_requests(session, [existing], user))[0]
        await case_scan(session, case, data.scan_id)
        if data.assignee_id:
            await eligible(session, user, data.kind, data.assignee_id)
        row = CaseRequest(organization=organization, case_id=case_id, scan_id=data.scan_id, kind=data.kind,
                          question=data.question, requested_by=user.id, assigned_to=data.assignee_id,
                          created_by=str(user.id), request_key=key, request_hash=digest,
                          status="assigned" if data.assignee_id else "open")
        session.add(row)
        await session.flush()
        record_change(session, row, user, "request_assigned" if data.assignee_id else "request_created", {})
        return (await show_requests(session, [row], user))[0]


async def snapshot_choices(session, row, case, user):
    checked = await case_scan(session, case, row.scan_id)
    scan = checked[0]
    path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    folder = await snapshot_folder(path, user.organization)
    policy = await asyncio.to_thread(results_for_display, folder, user.role)
    fields = ("id", "kind", "score_type", "score_status", "model", "model_version", "analysis_version", "saved_at")
    return [{key: item.get(key) for key in fields} for item in policy["results"]]


@router.get("/requests/{request_id}")
async def request_detail(organization: Organization, request_id: UUID, user: CurrentUser, session: Session):
    row, case = await request_context(session, user, request_id)
    actions = allowed_actions(row, case, user)
    has_case = user.role == "admin" or case.assigned_to == user.id
    scan = None
    if row.scan_id and (has_case or (row.assigned_to == user.id and row.status in WSI_STATUSES)):
        try:
            scan = await case_scan(session, case, row.scan_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
    events = (await session.scalars(select(ClinicalEvent).where(
        ClinicalEvent.organization == organization, ClinicalEvent.record_type == CaseRequest.__tablename__,
        ClinicalEvent.record_id == row.id).order_by(ClinicalEvent.version.desc()))).all()
    return {**(await show_requests(session, [row], user))[0],
            "case_id": case.id if has_case else None, "case_number": case.case_number,
            "actions": actions, "candidates": await eligible(session, user, row.kind) if "assign" in actions else [],
            "history": [{"version": event.version, "action": event.action, "at": event.occurred_at,
                         "before": event.before.get("status"), "after": event.after.get("status")} for event in events],
            "scan": {"id": scan[0].id, "label": scan[1], "stain": scan[2], "format": scan[0].format} if scan else None}


@router.get("/requests/{request_id}/results")
async def request_results(organization: Organization, request_id: UUID, user: CurrentUser, session: Session):
    row, case = await request_context(session, user, request_id)
    if row.kind != "ai" or row.assigned_to != user.id or row.status != "in_progress":
        raise HTTPException(404, "연결할 AI 결과를 조회할 수 없습니다.")
    return await snapshot_choices(session, row, case, user)


@router.patch("/requests/{request_id}")
async def change_request(organization: Organization, request_id: UUID, data: ChangeRequest, user: CurrentUser, session: Session):
    async with write(session, ROLES):
        row, case = await request_context(session, user, request_id, lock=True)
        manages = data.action in ("assign", "retry", "cancel")
        if not (can_manage(row, case, user) if manages else row.assigned_to == user.id):
            raise HTTPException(403, "요청을 변경할 권한이 없습니다.")
        require_version(row, data.version)
        if data.action not in allowed_actions(row, case, user):
            raise HTTPException(409, "현재 요청 상태에서 해당 처리를 할 수 없습니다.")
        before = state(row)
        previous = None
        if data.action == "assign":
            if row.assigned_to == data.assignee_id:
                return (await show_requests(session, [row], user))[0]
            previous = row.assigned_to
            row.assigned_to = await eligible(session, user, row.kind, data.assignee_id)
            row.status = "assigned"
            action = "request_reassigned" if previous else "request_assigned"
        else:
            row.status, action = {
                "start": ("in_progress", "request_started"), "complete": ("completed", "request_completed"),
                "fail": ("failed", "request_failed"), "retry": ("open", "request_reopened"),
                "cancel": ("cancelled", "request_cancelled"),
            }[data.action]
            if data.action == "complete":
                if row.kind == "ai":
                    if not data.snapshot_id:
                        raise HTTPException(422, "해당 스캔의 보관 AI 결과를 선택하세요.")
                    snapshot = next((item for item in await snapshot_choices(session, row, case, user)
                                     if item["id"] == data.snapshot_id), None)
                    if snapshot is None:
                        raise HTTPException(422, "해당 스캔의 보관 AI 결과를 선택하세요.")
                    row.snapshot = snapshot
                elif not data.note or data.snapshot_id:
                    raise HTTPException(422, "자문 답변을 입력하세요.")
                row.result_note = data.note or None
            elif data.action == "fail":
                if not data.note:
                    raise HTTPException(422, "처리 실패 사유를 입력하세요.")
                row.result_note = data.note
            elif data.action == "retry":
                previous, row.assigned_to = row.assigned_to, None
                row.result_note = None
        row.version += 1
        row.updated_at = datetime.now(timezone.utc)
        record_change(session, row, user, action, before, previous)
        return (await show_requests(session, [row], user))[0]


@router.get("/cases/{case_id}/report-draft-references")
async def draft_references(organization: Organization, case_id: UUID, user: CurrentUser, session: Session):
    require_roles(user, ROLES)
    await find(session, Case, organization, case_id)
    rows = (await session.scalars(select(CaseRequest).where(
        CaseRequest.organization == organization, CaseRequest.case_id == case_id, CaseRequest.status == "completed")
        .order_by(CaseRequest.updated_at.desc(), CaseRequest.id))).all()
    return await show_requests(session, rows, user)


@router.get("/request-notifications")
async def notifications(organization: Organization, user: CurrentUser, session: Session):
    require_roles(user, ROLES)
    condition = (RequestNotification.organization == organization, RequestNotification.recipient_id == user.id)
    unread = await session.scalar(select(func.count()).select_from(RequestNotification)
                                  .where(*condition, RequestNotification.read_at.is_(None)))
    rows = (await session.execute(select(RequestNotification, request_access(user).label("link"))
            .join(CaseRequest, CaseRequest.id == RequestNotification.request_id).join(Case, Case.id == CaseRequest.case_id)
            .where(*condition)
            .order_by(RequestNotification.read_at.is_not(None), RequestNotification.created_at.desc(),
                      RequestNotification.event_version.desc(), RequestNotification.id).limit(50))).all()
    return {"unread": unread, "items": [{"id": row.id, "action": row.action, "created_at": row.created_at,
                                      "request_id": row.request_id if link else None, "read_at": row.read_at}
                                     for row, link in rows]}


@router.post("/request-notifications/{notice_id}/read")
async def mark_read(organization: Organization, notice_id: UUID, user: CurrentUser, session: Session):
    async with write(session, ROLES):
        row = await session.scalar(select(RequestNotification).where(
            RequestNotification.organization == organization, RequestNotification.id == notice_id,
            RequestNotification.recipient_id == user.id).with_for_update())
        if row is None:
            raise HTTPException(404, "알림을 찾을 수 없습니다.")
        row.read_at = row.read_at or datetime.now(timezone.utc)
    return {"ok": True}


async def scoped_wsi(session, user, request_id):
    row, case = await request_context(session, user, request_id)
    if not row.scan_id or (user.role != "admin" and case.assigned_to != user.id
                           and (row.assigned_to != user.id or row.status not in WSI_STATUSES)):
        raise HTTPException(404, "요청의 스캔을 열 수 없습니다.")
    scan = (await case_scan(session, case, row.scan_id))[0]
    path, _ = await verified_scan_path(scan.storage_key, (scan.size_bytes, scan.modified_ns))
    await session.rollback()
    return path


@router.get("/requests/{request_id}/wsi")
async def request_wsi(organization: Organization, request_id: UUID, request: Request, response: Response,
                      user: CurrentUser, session: Session):
    response.headers.update(PRIVATE)
    return await scan_response(request, await scoped_wsi(session, user, request_id), "metadata")


@router.get("/requests/{request_id}/wsi/overview.jpeg")
async def request_overview(organization: Organization, request_id: UUID, request: Request, user: CurrentUser, session: Session,
                           size: Annotated[int, Query(ge=64, le=960)] = 960):
    return await scan_response(request, await scoped_wsi(session, user, request_id), "overview", size)


@router.get("/requests/{request_id}/wsi/{stage}/{x}/{y}.jpeg")
async def request_tile(organization: Organization, request_id: UUID, stage: int, x: int, y: int,
                       request: Request, user: CurrentUser, session: Session):
    if not 0 <= stage < len(STAGE_DOWNSAMPLES) or min(x, y) < 0:
        raise HTTPException(400, "타일 좌표를 확인하세요.")
    return await scan_response(request, await scoped_wsi(session, user, request_id), "tile", (stage, x, y))
