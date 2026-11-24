"""Leased, idempotent LIS delivery of explicitly queued approved revisions."""

import asyncio
import logging
from datetime import timedelta
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clinical import add_event
from app.connectors import AdapterUnavailable, invoke
from app.integration_service import digest, now
from app.models import IntegrationConnection, ReportTransmission

logger = logging.getLogger(__name__)
RETRY = (1, 3)
ACTIVE = ("queued", "sending", "retry_wait")


def approved_adapter(connection):
    # Production adapters require a separate reviewed implementation and an institutional test contract.
    return bool(connection and connection.mode == "mock" and connection.report_delivery_enabled)


def status_view(row):
    return {
        "id": row.id, "report_version": row.report_version, "status": row.status, "attempts": row.attempts,
        "error": row.error, "ack_id": row.ack_id, "finished_at": row.finished_at, "created_at": row.created_at,
        "kind": row.payload["kind"], "adapter": "mock",
    }


def step(session, row, action, previous):
    row.version += 1
    add_event(session, row, action, {"status": previous},
              {"status": row.status, "report_version": row.report_version, "attempts": row.attempts,
               "error": row.error, "ack_id": row.ack_id}, source="lis")


async def claim(engine):
    async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
        row = await session.scalar(select(ReportTransmission).where(
            ReportTransmission.status.in_(ACTIVE), ReportTransmission.due_at <= now(),
        ).order_by(ReportTransmission.due_at, ReportTransmission.id).limit(1).with_for_update(skip_locked=True))
        if row is None:
            return None
        config = await session.get(IntegrationConnection, (row.organization, "lis"))
        previous = row.status
        session.info["user"] = SimpleNamespace(id="lis.mock")
        invalid = None
        if not approved_adapter(config):
            invalid = "adapter_disabled"
        elif row.attempts > len(RETRY):
            invalid = "interrupted"
        elif digest(row.payload) != row.digest:
            invalid = "payload_changed"
        if invalid:
            row.status, row.finished_at, row.error = "failed", now(), invalid
            step(session, row, "report_delivery_failed", previous)
            return None
        row.status = "sending"
        row.attempts += 1
        row.due_at = now() + timedelta(seconds=30)
        step(session, row, "report_delivery_attempted", previous)
        adapter = SimpleNamespace(mode=config.mode, scenario=config.scenario)
        message = {"message_id": str(row.id), "digest": row.digest, "document": row.payload}
        return row.id, row.attempts, adapter, message


def ack_result(message, acknowledgement):
    if (not isinstance(acknowledgement, dict)
            or acknowledgement.get("message_id") != message["message_id"]
            or acknowledgement.get("digest") != message["digest"]
            or not isinstance(acknowledgement.get("ack_id"), str)
            or not 1 <= len(acknowledgement["ack_id"]) <= 128
            or acknowledgement.get("status") not in ("accepted", "rejected")):
        return None, "invalid_ack"
    if acknowledgement["status"] == "rejected":
        return acknowledgement["ack_id"], "rejected"
    return acknowledgement["ack_id"], None


async def process_report(engine):
    claimed = await claim(engine)
    if claimed is None:
        return
    identifier, attempt, connection, message = claimed
    ack_id = None
    try:
        ack_id, error = ack_result(message, await invoke(connection, "send_report", message))
    except asyncio.TimeoutError:
        error = "timeout"
    except AdapterUnavailable:
        error = "unavailable"
    except Exception as exc:
        logger.warning("LIS report adapter failed (%s).", type(exc).__name__)
        error = "adapter_error"
    async with AsyncSession(engine) as session, session.begin():
        row = await session.get(ReportTransmission, identifier, with_for_update=True)
        if row is None or (row.status, row.attempts) != ("sending", attempt):
            return
        row.error, row.ack_id = error, ack_id
        if error and error != "rejected" and attempt <= len(RETRY):
            row.status, row.due_at = "retry_wait", now() + timedelta(seconds=RETRY[attempt - 1])
        else:
            row.status, row.finished_at = ("failed" if error else "acknowledged"), now()
        session.info["user"] = SimpleNamespace(id="lis.mock")
        step(session, row, f"report_delivery_{row.status}", "sending")


async def poll_reports(engine):
    while True:
        try:
            await process_report(engine)
        except Exception as exc:
            logger.warning("LIS report queue processing failed (%s).", type(exc).__name__)
        await asyncio.sleep(0.4)
