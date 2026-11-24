"""Create notification outbox records in the originating clinical transaction."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthUser, Case, CaseRequest, NotificationDelivery, NotificationPreference, RequestNotification
from app.notification_transport import DeliveryProblem, send_email, send_push

EVENTS = ("case_assignment", "request", "mention", "case_comment")
CHANNELS = ("in_app", "email", "push")
MAX_ATTEMPTS = 3
RETRY_DELAYS = (2, 10)
logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc)


def enabled(preference, event, channel):
    return (preference.rules.get(event, {}).get(channel, channel == "in_app")
            if preference else channel == "in_app")


async def enqueue(session, *, organization, case_id, recipients, event, action, event_key, request=None):
    for recipient, recipient_action in recipients.items():
        if recipient is None:
            continue
        active = await session.scalar(select(AuthUser.id).where(AuthUser.organization == organization,
                                                               AuthUser.id == recipient, AuthUser.active.is_(True)))
        if active is None:
            continue
        preference = await session.get(NotificationPreference, (organization, recipient))
        for channel in CHANNELS:
            if not enabled(preference, event, channel):
                continue
            if request and channel == "in_app":
                await session.execute(insert(RequestNotification).values(
                    organization=organization, request_id=request.id, recipient_id=recipient,
                    event_version=request.version, action=recipient_action or action,
                ).on_conflict_do_nothing())
            else:
                await session.execute(insert(NotificationDelivery).values(
                    organization=organization, recipient_id=recipient, case_id=case_id,
                    request_id=request.id if request else None, event_key=event_key, event=event,
                    action=recipient_action or action, channel=channel,
                    status="delivered" if channel == "in_app" else "queued",
                    finished_at=now() if channel == "in_app" else None,
                ).on_conflict_do_nothing())


def can_open_case(case, user):
    return user.role in ("admin", "labeler") or case.assigned_to == user.id


def can_open_request(case, request, user):
    return user.role == "admin" or (user.role == "doctor" and user.id in
        (case.assigned_to, request.requested_by, request.assigned_to))


async def claim(engine):
    async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
        event = await session.scalar(select(NotificationDelivery).where(
            NotificationDelivery.status.in_(("queued", "retry_wait", "sending")),
            NotificationDelivery.next_attempt_at <= now(),
        ).order_by(NotificationDelivery.next_attempt_at, NotificationDelivery.id).limit(1).with_for_update(skip_locked=True))
        if event is None:
            return None
        if event.attempts >= MAX_ATTEMPTS:
            event.status, event.error, event.finished_at = "failed", "delivery_interrupted", now()
            return None
        user = await session.get(AuthUser, event.recipient_id)
        preference = await session.get(NotificationPreference, (event.organization, event.recipient_id))
        case = await session.get(Case, event.case_id)
        request = await session.get(CaseRequest, event.request_id) if event.request_id else None
        if not user.active or not (can_open_request(case, request, user) if request else can_open_case(case, user)):
            event.status, event.error, event.finished_at = "blocked", "access_changed", now()
            return None
        if not enabled(preference, event.event, event.channel):
            event.status, event.error, event.finished_at = "blocked", "preference_disabled", now()
            return None
        event.status = "sending"
        event.attempts += 1
        event.next_attempt_at = now() + timedelta(minutes=2)
        subscription = ({"endpoint": preference.push_endpoint, "keys": preference.push_keys}
                        if preference and preference.push_endpoint and preference.push_keys else None)
        return event.id, event.attempts, event.channel, user.notification_email, subscription


async def process_delivery(engine):
    delivery = await claim(engine)
    if delivery is None:
        return
    identifier, attempt, channel, email, subscription = delivery
    code, status = None, "delivered"
    try:
        if channel == "email":
            await asyncio.to_thread(send_email, email, identifier)
        else:
            await asyncio.to_thread(send_push, subscription, identifier)
    except DeliveryProblem as problem:
        code, status = problem.code, problem.status
    except Exception as error:
        code, status = "delivery_interrupted", "retry_wait"
        logger.warning("Notification delivery failed (%s).", type(error).__name__)
    async with AsyncSession(engine) as session, session.begin():
        event = await session.get(NotificationDelivery, identifier, with_for_update=True)
        if event is None or (event.status, event.attempts) != ("sending", attempt):
            return
        if status == "retry_wait" and attempt >= MAX_ATTEMPTS:
            status = "failed"
        event.status, event.error = status, code
        if status == "retry_wait":
            event.next_attempt_at = now() + timedelta(seconds=RETRY_DELAYS[attempt - 1])
        else:
            event.finished_at = now()
        if code == "subscription_expired":
            preference = await session.get(NotificationPreference, (event.organization, event.recipient_id), with_for_update=True)
            if preference and subscription and preference.push_endpoint == subscription["endpoint"]:
                preference.push_endpoint = None
                preference.push_keys = None


async def poll_deliveries(engine):
    while True:
        try:
            await process_delivery(engine)
        except Exception as error:
            logger.warning("Notification queue processing failed (%s).", type(error).__name__)
        await asyncio.sleep(0.5)
