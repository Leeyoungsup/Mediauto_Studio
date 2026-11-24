"""Personal channel settings, delivery status, and the combined inbox."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.auth import CurrentUser
from app.case_requests import ROLES as REQUEST_ROLES, notifications as legacy_inbox
from app.clinical import ClinicalInput, Organization, Session, write
from app.models import Case, CaseRequest, NotificationDelivery, NotificationPreference
from app.notification_delivery import can_open_case, can_open_request, now
from app.notification_transport import email_valid, push_keys_valid, smtp_settings, valid_push_endpoint, vapid_settings

router = APIRouter(prefix="/api/clinical/{organization}/notifications", tags=["Notifications"])


class Channels(ClinicalInput):
    in_app: bool = True
    email: bool = False
    push: bool = False


class Rules(ClinicalInput):
    case_assignment: Channels = Field(default_factory=Channels)
    request: Channels = Field(default_factory=Channels)
    mention: Channels = Field(default_factory=Channels)
    case_comment: Channels = Field(default_factory=Channels)


class PreferencesUpdate(ClinicalInput):
    version: Annotated[int, Field(ge=0)]
    rules: Rules


Key = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,100}$")]


class PushKeys(ClinicalInput):
    p256dh: Key
    auth: Key


class PushSubscription(ClinicalInput):
    endpoint: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    keys: PushKeys


def identity(user):
    return {"organization": user.organization, "user_id": user.id}


async def preference_for(session, user, lock=False):
    if lock:
        await session.execute(insert(NotificationPreference).values(**identity(user)).on_conflict_do_nothing())
    return await session.get(NotificationPreference, (user.organization, user.id), with_for_update=lock)


def settings_view(user, saved):
    push = vapid_settings()
    return {
        "version": saved.version if saved else 0, "rules": Rules.model_validate(saved.rules) if saved else Rules(),
        "email_configured": smtp_settings() is not None, "email_registered": email_valid(user.notification_email),
        "push_configured": push is not None, "push_registered": bool(saved and saved.push_endpoint),
        "push_public_key": push[2] if push else None,
    }


@router.get("/preferences")
async def settings(organization: Organization, user: CurrentUser, session: Session):
    return settings_view(user, await preference_for(session, user))


@router.put("/preferences")
async def save_settings(organization: Organization, data: PreferencesUpdate, user: CurrentUser, session: Session):
    async with write(session, ("admin", "doctor", "labeler", "viewer")):
        saved = await preference_for(session, user, lock=True)
        if saved.version != data.version:
            raise HTTPException(409, "Notification preferences changed in another session. Reload them and try again.")
        saved.rules = data.rules.model_dump()
        saved.version += 1
        return settings_view(user, saved)


@router.put("/push-subscription")
async def register_push(organization: Organization, data: PushSubscription, user: CurrentUser, session: Session):
    keys = data.keys.model_dump()
    if not valid_push_endpoint(data.endpoint) or not push_keys_valid(keys):
        raise HTTPException(422, "This browser Push subscription is unsupported.")
    if vapid_settings() is None:
        raise HTTPException(409, "Browser Push is not configured on this server.")
    async with write(session, ("admin", "doctor", "labeler", "viewer")):
        saved = await preference_for(session, user, lock=True)
        saved.push_endpoint, saved.push_keys = data.endpoint, keys
    return {"ok": True}


@router.delete("/push-subscription")
async def disconnect_push(organization: Organization, user: CurrentUser, session: Session):
    async with session.begin():
        saved = await session.get(NotificationPreference, (organization, user.id), with_for_update=True)
        if saved:
            saved.push_endpoint, saved.push_keys = None, None
    return {"ok": True}


def visible_delivery(row, case, request, user):
    allowed = can_open_request(case, request, user) if request else can_open_case(case, user)
    return {"id": row.id, "event": row.event, "action": row.action, "channel": row.channel, "status": row.status,
            "attempts": row.attempts, "error": row.error, "created_at": row.created_at, "read_at": row.read_at,
            "finished_at": row.finished_at, "case_id": row.case_id if allowed and not request else None,
            "request_id": row.request_id if allowed else None}


@router.get("")
async def inbox(organization: Organization, user: CurrentUser, session: Session):
    own = (NotificationDelivery.organization == organization, NotificationDelivery.recipient_id == user.id)
    query = (select(NotificationDelivery, Case, CaseRequest).join(Case, Case.id == NotificationDelivery.case_id)        .outerjoin(CaseRequest, CaseRequest.id == NotificationDelivery.request_id).where(*own))
    items = (await session.execute(query.where(NotificationDelivery.channel == "in_app")
        .order_by(NotificationDelivery.read_at.is_not(None), NotificationDelivery.created_at.desc(), NotificationDelivery.id)
        .limit(50))).all()
    external = (await session.execute(query.where(NotificationDelivery.channel != "in_app")
        .order_by(NotificationDelivery.created_at.desc(), NotificationDelivery.id).limit(50))).all()
    count = await session.scalar(select(func.count()).select_from(NotificationDelivery).where(
        *own, NotificationDelivery.channel == "in_app", NotificationDelivery.read_at.is_(None)))
    legacy = await legacy_inbox(organization, user, session) if user.role in REQUEST_ROLES else {"items": [], "unread": 0}
    notices = [visible_delivery(row, case, request, user) for row, case, request in items]
    notices.extend({**item, "event": "request", "channel": "in_app", "status": "delivered", "legacy": True}
                   for item in legacy["items"])
    notices.sort(key=lambda row: (row["read_at"] is None, row["created_at"], row["id"]), reverse=True)
    return {"unread": count + legacy["unread"], "items": notices[:50],
            "deliveries": [visible_delivery(row, case, request, user) for row, case, request in external]}


async def owned_delivery(session, user, identifier):
    row = await session.scalar(select(NotificationDelivery).where(
        NotificationDelivery.id == identifier, NotificationDelivery.organization == user.organization,
        NotificationDelivery.recipient_id == user.id,
    ).with_for_update())
    if row is None:
        raise HTTPException(404, "Notification not found.")
    return row


@router.post("/{identifier}/read")
async def read_notice(organization: Organization, identifier: UUID, user: CurrentUser, session: Session):
    async with session.begin():
        row = await owned_delivery(session, user, identifier)
        if row.channel != "in_app":
            raise HTTPException(404, "Notification not found.")
        row.read_at = row.read_at or now()
    return {"ok": True}


@router.post("/{identifier}/retry")
async def retry_delivery(organization: Organization, identifier: UUID, user: CurrentUser, session: Session):
    async with session.begin():
        row = await owned_delivery(session, user, identifier)
        if row.channel == "in_app" or row.status not in ("failed", "blocked"):
            raise HTTPException(409, "This notification is not available for retry.")
        row.status, row.attempts, row.error = "queued", 0, None
        row.next_attempt_at, row.finished_at = now(), None
    return {"ok": True}
