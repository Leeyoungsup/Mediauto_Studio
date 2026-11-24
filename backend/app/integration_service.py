"""Inbox processing, bounded retry, and source snapshot reconciliation."""

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.connectors import AdapterUnavailable, invoke
from app.models import ExternalIdentifier, ExternalSnapshot, IntegrationConnection, IntegrationMessage, Patient

logger = logging.getLogger(__name__)
SYSTEM = {"emr": "emr.mock", "lis": "lis.mock"}
KIND = {"patient": "MRN", "case": "ACCESSION", "specimen": "SPECIMEN_ID", "slide": "SLIDE_ID"}
PENDING = ("queued", "retry_wait")
RETRY_SECONDS = (1, 2, 4)


def now():
    return datetime.now(timezone.utc)


def digest(payload):
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def identifier_query(organization, channel, resource, external_id):
    return select(ExternalIdentifier).where(
        ExternalIdentifier.organization == organization, ExternalIdentifier.system == SYSTEM[channel],
        ExternalIdentifier.kind == KIND[resource], ExternalIdentifier.value == external_id,
    )


def snapshot_key(organization, channel, resource, external_id):
    return (organization, channel, resource, external_id)


def patient_differences(patient, incoming):
    if patient is None:
        return []
    local = {
        "display_name": patient.display_name,
        "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
    }
    return [field for field, value in local.items()
            if value and incoming.get(field) and value != incoming[field]]


async def set_connection_state(session, connection, error):
    current = await session.get(IntegrationConnection, (connection.organization, connection.channel), with_for_update=True)
    if current is None or current.version != connection.version or current.mode != connection.mode:
        return False
    checked = now()
    current.state = "degraded" if error else "connected"
    current.checked_at = checked
    if not error:
        current.last_success_at = checked
    return True


async def reconcile(session, message, payload):
    key = snapshot_key(message.organization, message.channel, payload["resource"], payload["external_id"])
    revision = payload["revision"]
    content = payload["data"]
    checksum = digest(content)
    await session.execute(insert(ExternalSnapshot).values(
        organization=key[0], channel=key[1], resource=key[2], external_id=key[3], revision=0,
        payload={}, digest="", received_at=message.received_at, first_received_at=message.received_at,
    ).on_conflict_do_nothing())
    current = await session.get(ExternalSnapshot, key, with_for_update=True)
    current.first_received_at = min(current.first_received_at, message.received_at)
    if revision < current.revision:
        return "stale", "older_revision"
    if revision == current.revision:
        return ("duplicate", None) if checksum == current.digest else ("conflict", "same_revision_different_data")
    current.revision, current.payload, current.digest, current.received_at = revision, content, checksum, message.received_at
    external = await session.scalar(identifier_query(*key).with_for_update())
    if external is None:
        return "pending_link", None
    owner_id = getattr(external, f"{payload['resource']}_id")
    if owner_id is None:
        return "conflict", "external_id_wrong_record_type"
    if payload["resource"] == "patient":
        # The identifier row serializes confirmations. Local demographics are never overwritten.
        local = await session.get(Patient, owner_id)
        if patient_differences(local, content):
            external.connection_state = "needs_review"
            return "conflict", "patient_demographics_differ"
    external.connection_state, external.last_synced_at = "linked", message.received_at
    return "applied", None


async def process_one(engine, record_id):
    async with AsyncSession(engine, expire_on_commit=False) as session:
        message = await session.get(IntegrationMessage, record_id)
        if message is None or message.state not in PENDING or message.next_attempt_at > now():
            return
        attempts = message.attempts
        envelope = message.payload
        connection = await session.get(IntegrationConnection, (message.organization, message.channel))
        if connection is None or connection.mode not in ("mock",):
            return
    failure = None
    try:
        payload = await invoke(connection, "receive", envelope)
    except asyncio.TimeoutError:
        failure = "timeout"
    except AdapterUnavailable:
        failure = "unavailable"
    async with AsyncSession(engine) as session, session.begin():
        message = await session.get(IntegrationMessage, record_id, with_for_update=True)
        if message is None or message.attempts != attempts or message.state not in PENDING:
            return
        if not await set_connection_state(session, connection, failure):
            return
        stamp = now()
        message.attempts += 1
        if failure:
            message.error = failure
            if message.attempts <= len(RETRY_SECONDS):
                message.state = "retry_wait"
                message.next_attempt_at = stamp + timedelta(seconds=RETRY_SECONDS[message.attempts - 1])
                return
            message.state = "dead_letter"
        else:
            message.state, message.error = await reconcile(session, message, payload)
        message.finished_at = stamp


async def process_batch(engine):
    async with AsyncSession(engine) as session:
        due = (await session.scalars(select(IntegrationMessage.id)
            .join(IntegrationConnection,
                  (IntegrationConnection.organization == IntegrationMessage.organization)
                  & (IntegrationConnection.channel == IntegrationMessage.channel))
            .where(IntegrationConnection.mode == "mock", IntegrationMessage.state.in_(PENDING),
                   IntegrationMessage.next_attempt_at <= now())
            .order_by(IntegrationMessage.received_at, IntegrationMessage.id).limit(10))).all()
    for record_id in due:
        try:
            await process_one(engine, record_id)
        except Exception as error:
            logger.warning("Integration message processing failed (%s)", type(error).__name__)


async def poll_inbox(engine):
    while True:
        try:
            await process_batch(engine)
        except Exception as error:
            logger.warning("Integration inbox batch failed (%s)", type(error).__name__)
        await asyncio.sleep(0.5)
