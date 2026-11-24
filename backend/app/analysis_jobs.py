"""Durable local analysis queue, versioned attempts, and QC-gated pre-run rules."""

import asyncio
import logging
from contextlib import suppress
from datetime import timedelta
from threading import Event
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis_adapters import AnalysisFailure, PROFILES, execute, marker_for
from app.clinical import add_event
from app.integration_service import digest, now
from app.models import AnalysisRule, AnalysisRun, AuthUser, Case, CaseRequest, Slide, SlideScan, Specimen
from app.scan_quality import BLOCKED_QC

logger = logging.getLogger(__name__)
ACTIVE = ("queued", "running")
WORKER = SimpleNamespace(id="analysis.local")
LEASE = timedelta(seconds=30)
RUN_TIMEOUT = 12


def run_view(row):
    return {"id": str(row.id), "model": row.model_key, "model_version": row.model_version, "marker": row.marker,
            "scan_id": str(row.scan_id), "request_id": str(row.request_id), "attempt": row.attempt, "status": row.status,
            "origin": "rule" if row.trigger_key else "manual", "result": row.result, "error": row.error,
            "created_at": row.created_at.isoformat(), "started_at": row.started_at.isoformat() if row.started_at else None,
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


def source_of(scan):
    return {"storage_key": scan.storage_key, "size_bytes": scan.size_bytes, "modified_ns": scan.modified_ns}


def jobs_for(request_id):
    return select(AnalysisRun).where(AnalysisRun.request_id == request_id).order_by(AnalysisRun.attempt.desc())


def event(session, run, action, previous=None):
    if previous:
        run.version += 1
    add_event(session, run, action, {"status": previous} if previous else {},
              {"status": run.status, "model": run.model_key, "model_version": run.model_version, "attempt": run.attempt,
               "request_id": str(run.request_id), "scan_id": str(run.scan_id), "error": run.error,
               "snapshot_id": run.result.get("snapshot", {}).get("id") if run.result else None},
              source="analysis", case_id=run.case_id)


async def queue_run(session, request, scan, stain, model, key, previous=None, trigger=None):
    profile = PROFILES.get(model)
    marker = marker_for(stain)
    if profile is None or marker not in profile.markers:
        raise HTTPException(422, "Choose an execution model approved for this registered stain.")
    if previous and (previous.model_version != profile.version or previous.source != source_of(scan) or previous.marker != marker):
        raise HTTPException(409, "The pinned model or scan changed. Create a new request.")
    snapshot = previous.result.get("snapshot") if previous and previous.result else None
    run = AnalysisRun(organization=request.organization, case_id=request.case_id, request_id=request.id,
        scan_id=scan.id, model_key=model, model_version=profile.version, marker=marker,
        request_key=key, attempt=previous.attempt + 1 if previous else 1, trigger_key=trigger,
        source=source_of(scan), status="queued", created_by=str(session.info["user"].id),
        pinned_snapshot=(snapshot["id"] if snapshot else previous.pinned_snapshot if previous else None))
    session.add(run)
    await session.flush()
    event(session, run, "analysis_queued")
    return run


async def update_request(session, row, case, status, actor, snapshot=None):
    from app.case_requests import record_change, state

    before = state(row)
    if snapshot:
        row.snapshot = snapshot
    row.status = status
    row.version += 1
    row.updated_at = now()
    await record_change(session, row, actor, {"in_progress": "request_started", "completed": "request_completed",
        "failed": "request_failed", "cancelled": "request_cancelled"}[status], before, case=case)


async def scoped_source(session, run):
    return (await session.execute(select(SlideScan, Slide.stain).join(Slide, SlideScan.slide_id == Slide.id)
        .join(Specimen, Slide.specimen_id == Specimen.id).where(
            SlideScan.id == run.scan_id, SlideScan.organization == run.organization, Specimen.case_id == run.case_id,
            SlideScan.status == "registered", SlideScan.qc_status.not_in(BLOCKED_QC)))).one_or_none()


async def claim(engine):
    async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
        run = await session.scalar(select(AnalysisRun).where(or_(AnalysisRun.status == "queued",
            and_(AnalysisRun.status == "running", AnalysisRun.started_at < now() - LEASE)))
            .order_by(AnalysisRun.created_at, AnalysisRun.id).limit(1).with_for_update(skip_locked=True))
        if run is None:
            return None
        if run.status == "running":
            return run, "worker_interrupted"
        run.status, run.started_at = "running", now()
        session.info["user"] = WORKER
        event(session, run, "analysis_started", "queued")
        source = await scoped_source(session, run)
        if source is None or source_of(source[0]) != run.source or marker_for(source[1]) != run.marker:
            return run, "scan_changed"
        return run, None


async def finish(engine, claim, result=None, error=None):
    async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
        case = await session.get(Case, claim.case_id, with_for_update=True)
        row = await session.get(CaseRequest, claim.request_id, with_for_update=True)
        run = await session.get(AnalysisRun, claim.id, with_for_update=True)
        if not run or run.status != "running" or not row or not case:
            return
        source = await scoped_source(session, run)
        if not error and (source is None or source_of(source[0]) != run.source or marker_for(source[1]) != run.marker):
            error = "scan_changed"
        if error:
            result = None
        session.info["user"] = WORKER
        run.status, run.finished_at, run.result, run.error = ("failed" if error else "completed"), now(), result, error
        event(session, run, "analysis_" + run.status, "running")
        await update_request(session, row, case, run.status, WORKER, result.get("snapshot") if result else None)


async def observe_cancellation(engine, run_id, signal):
    while not signal.is_set():
        await asyncio.sleep(0.4)
        async with AsyncSession(engine) as session:
            status = await session.scalar(select(AnalysisRun.status).where(AnalysisRun.id == run_id))
        if status != "running":
            signal.set()


async def run_once(engine):
    claimed = await claim(engine)
    if not claimed:
        return False
    run, error = claimed
    if error:
        await finish(engine, run, error=error)
        return True
    cancelled = Event()
    task = asyncio.create_task(execute(run.organization, run.model_key, run.model_version, run.source, run.pinned_snapshot, cancelled))
    monitor = asyncio.create_task(observe_cancellation(engine, run.id, cancelled))
    try:
        result = await asyncio.wait_for(asyncio.shield(task), timeout=RUN_TIMEOUT)
        await finish(engine, run, result=result)
    except asyncio.TimeoutError:
        cancelled.set()
        await finish(engine, run, error="timeout")
        # Keep the worker slot until a native scan read exits.
        with suppress(Exception):
            await task
    except AnalysisFailure as exc:
        await finish(engine, run, error=str(exc))
    except (HTTPException, OSError, ValueError):
        await finish(engine, run, error="scan_unavailable")
    except asyncio.CancelledError:
        cancelled.set()
        task.cancel()
        raise
    except Exception as exc:
        logger.warning("Analysis execution failed (%s).", type(exc).__name__)
        await finish(engine, run, error="adapter_error")
    finally:
        monitor.cancel()
        with suppress(asyncio.CancelledError):
            await monitor
    return True


async def schedule_rule(engine):
    from app.case_requests import record_change

    marker = func.regexp_replace(func.lower(Slide.stain), "[^a-z0-9]", "", "g")
    existing = select(AnalysisRun.id).where(AnalysisRun.scan_id == SlideScan.id,
                                            AnalysisRun.model_key == AnalysisRule.model_key).exists()
    supported = or_(*(and_(AnalysisRule.model_key == model, AnalysisRule.marker.in_(profile.markers))
                      for model, profile in PROFILES.items()))
    async with AsyncSession(engine, expire_on_commit=False) as session, session.begin():
        match = (await session.execute(select(Case, SlideScan, Slide.stain, AnalysisRule, AuthUser)
            .select_from(Case).join(Specimen, Specimen.case_id == Case.id).join(Slide, Slide.specimen_id == Specimen.id)
            .join(SlideScan, SlideScan.slide_id == Slide.id)
            .join(AnalysisRule, (AnalysisRule.organization == Case.organization) & (AnalysisRule.marker == marker))
            .join(AuthUser, (AuthUser.organization == AnalysisRule.organization) & (AuthUser.id == AnalysisRule.created_by.cast(AuthUser.id.type)))
            .where(AnalysisRule.active.is_(True), AuthUser.active.is_(True), AuthUser.role == "admin",
                   Case.status.in_(("registered", "assigned")),
                   SlideScan.qc_status == "passed", SlideScan.status == "registered", ~existing, supported)
            .order_by(SlideScan.created_at, SlideScan.id, AnalysisRule.id).limit(1).with_for_update(of=Case, skip_locked=True))).one_or_none()
        if match is None:
            return
        case, scan, stain, rule, owner = match
        session.info["user"] = WORKER
        trigger = f"rule:{rule.id}:{scan.id}"
        question = f"Pre-run rule · {PROFILES[rule.model_key].name}."
        row = CaseRequest(organization=case.organization, case_id=case.id, scan_id=scan.id, kind="ai",
            question=question, requested_by=owner.id, assigned_to=case.assigned_to, created_by=str(WORKER.id),
            request_key=trigger, request_hash=digest({"rule": str(rule.id), "scan": str(scan.id)}), status="in_progress")
        session.add(row)
        await session.flush()
        await queue_run(session, row, scan, stain, rule.model_key, trigger, trigger=trigger)
        await record_change(session, row, WORKER, "request_created", {}, case=case)


async def poll_analysis(engine):
    while True:
        try:
            await schedule_rule(engine)
            worked = await run_once(engine)
        except Exception as exc:
            logger.warning("Analysis worker cycle failed (%s).", type(exc).__name__)
            worked = False
        await asyncio.sleep(0.15 if worked else 1)
