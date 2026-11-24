"""API scopes for manual jobs, administrator pre-runs, and human IHC interpretation."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field

from sqlalchemy import select

from app.auth import require_roles
from app.analysis_adapters import MARKERS, PROFILES, marker_for
from app.analysis_jobs import ACTIVE, event, jobs_for, queue_run, run_view, update_request
from app.case_requests import ROLES, can_manage, case_scan, request_context
from app.clinical import ClinicalInput, Organization, Reason, RegistrationKey, Session, add_event, find, require_version, write
from app.integration_service import now
from app.models import AnalysisRule, AnalysisRun, Case, IhcReview, Slide, SlideScan, Specimen, SpecimenBlock
from app.scan_quality import BLOCKED_QC

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Analysis execution"])
ModelKey = Literal["pdl1_cps_archive", "pdl1_tps_archive", "ihc_preflight"]
Version = Annotated[int, Field(ge=0)]


class RuleInput(ClinicalInput):
    model: ModelKey
    marker: Literal["pdl1", "er", "pr", "her2", "ki67"]
    active: bool
    version: Version = 0


class RunInput(ClinicalInput):
    run_id: UUID
    action: Literal["cancel", "rerun"]


class ReviewInput(ClinicalInput):
    version: Version
    scan_id: UUID
    interpretation: Literal["positive", "negative", "indeterminate", "uninterpretable"]
    block_id: UUID
    run_id: UUID | None = None
    rationale: Reason


def model_catalog():
    return [{"key": key, "name": profile.name, "version": profile.version, "markers": profile.markers,
             "checkpoint": profile.checkpoint} for key, profile in PROFILES.items()]


@router.get("/analysis-models")
async def analysis_models(organization: Organization, session: Session):
    require_roles(session.info["user"], ROLES)
    return {"models": model_catalog(), "markers": MARKERS}


def rule_view(row):
    return {"id": str(row.id), "model": row.model_key, "marker": row.marker, "active": row.active, "version": row.version}


@router.get("/analysis-rules")
async def get_analysis_rules(organization: Organization, session: Session):
    require_roles(session.info["user"], ("admin",))
    rows = await session.scalars(select(AnalysisRule).where(AnalysisRule.organization == organization)
                                .order_by(AnalysisRule.model_key, AnalysisRule.marker))
    return {"rules": [rule_view(row) for row in rows], "models": model_catalog(), "markers": MARKERS}


@router.put("/analysis-rules")
async def save_analysis_rule(organization: Organization, data: RuleInput, session: Session):
    async with write(session, ("admin",)):
        if data.marker not in PROFILES[data.model].markers:
            raise HTTPException(422, "The marker does not match the model input.")
        row = await session.scalar(select(AnalysisRule).where(AnalysisRule.organization == organization,
            AnalysisRule.model_key == data.model, AnalysisRule.marker == data.marker).with_for_update())
        before = rule_view(row) if row else {}
        if row:
            require_version(row, data.version)
            if row.active == data.active:
                return before
            row.active, row.version = data.active, row.version + 1
        else:
            if data.version:
                raise HTTPException(409, "Reload the saved rules.")
            row = AnalysisRule(organization=organization, model_key=data.model, marker=data.marker, active=data.active,
                               created_by=str(session.info["user"].id))
            session.add(row)
            await session.flush()
        add_event(session, row, "analysis_rule_saved", before, rule_view(row), source="analysis")
        return rule_view(row)


@router.get("/requests/{request_id}/execution")
async def request_execution(organization: Organization, request_id: UUID, session: Session):
    user = session.info["user"]
    row, case = await request_context(session, user, request_id)
    return {"runs": [run_view(run) for run in await session.scalars(jobs_for(row.id))],
            "can_manage": can_manage(row, case, user), "models": model_catalog()}


@router.post("/requests/{request_id}/execution")
async def change_execution(organization: Organization, request_id: UUID, data: RunInput, key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ROLES):
        row, case = await request_context(session, user, request_id, lock=True)
        if not can_manage(row, case, user):
            raise HTTPException(403, "You do not have permission to control this model run.")
        source = await session.scalar(jobs_for(row.id).where(AnalysisRun.id == data.run_id).with_for_update())
        if source is None:
            raise HTTPException(404, "Analysis run not found.")
        if data.action == "cancel":
            if source.status in ACTIVE:
                old = source.status
                source.status, source.finished_at = "cancelled", now()
                event(session, source, "analysis_cancelled", old)
                await update_request(session, row, case, "cancelled", user)
            elif source.status != "cancelled":
                raise HTTPException(409, "Only queued or running jobs can be cancelled.")
            return run_view(source)
        previous = await session.scalar(jobs_for(row.id).where(AnalysisRun.request_key == key))
        if previous is not None:
            if previous.attempt != source.attempt + 1:
                raise HTTPException(409, "This run key was used for another attempt.")
            return run_view(previous)
        current = await session.scalar(jobs_for(row.id).limit(1))
        if current.id != source.id or current.status in ACTIVE:
            raise HTTPException(409, "Select the latest completed, failed, or cancelled run.")
        checked = await case_scan(session, case, row.scan_id)
        replay = await queue_run(session, row, checked[0], checked[2], source.model_key, key, previous=source)
        await update_request(session, row, case, "in_progress", user)
        return run_view(replay)


def scan_choices(case):
    return (select(SlideScan.id, Slide.slide_number, Slide.stain, Specimen.id.label("specimen_id"), Specimen.specimen_number)
            .select_from(SlideScan).join(Slide, SlideScan.slide_id == Slide.id).join(Specimen, Slide.specimen_id == Specimen.id)
            .where(SlideScan.organization == case.organization, Specimen.case_id == case.id,
                   SlideScan.status == "registered", SlideScan.qc_status.not_in(BLOCKED_QC)))


def review_view(row):
    return {"id": str(row.id), "version": row.version, "marker": row.marker, "interpretation": row.interpretation,
            "specimen_id": str(row.specimen_id), "scan_id": str(row.scan_id), "block_id": str(row.block_id),
            "block_number": row.block_number, "run_id": str(row.run_id) if row.run_id else None,
            "rationale": row.rationale, "reviewed_by": row.created_by, "created_at": row.created_at.isoformat()}


@router.get("/cases/{case_id}/ihc-reviews")
async def get_ihc_reviews(organization: Organization, case_id: UUID, session: Session):
    user = session.info["user"]
    require_roles(user, ROLES)
    case = await find(session, Case, organization, case_id)
    scans = [{"id": str(row.id), "slide": row.slide_number, "marker": marker_for(row.stain),
              "specimen_id": str(row.specimen_id), "specimen": row.specimen_number}
             for row in (await session.execute(scan_choices(case).order_by(Specimen.specimen_number, Slide.slide_number, SlideScan.id))).all()
             if marker_for(row.stain) in MARKERS]
    blocks = await session.scalars(select(SpecimenBlock).where(
        SpecimenBlock.organization == organization, SpecimenBlock.specimen_id.in_({row["specimen_id"] for row in scans}),
    ).order_by(SpecimenBlock.block_number))
    runs = await session.scalars(select(AnalysisRun).where(AnalysisRun.organization == organization,
        AnalysisRun.case_id == case_id, AnalysisRun.status == "completed").order_by(AnalysisRun.created_at.desc()))
    history = await session.scalars(select(IhcReview).where(
        IhcReview.organization == organization, IhcReview.case_id == case_id).order_by(IhcReview.created_at.desc(), IhcReview.id))
    return {"can_review": user.role == "doctor" and case.assigned_to == user.id, "markers": MARKERS, "scans": scans,
            "blocks": [{"id": str(block.id), "number": block.block_number, "specimen_id": str(block.specimen_id)} for block in blocks],
            "runs": [run_view(run) for run in runs], "history": [review_view(row) for row in history]}


@router.post("/cases/{case_id}/ihc-reviews", status_code=201)
async def save_ihc_review(organization: Organization, case_id: UUID, data: ReviewInput, key: RegistrationKey, session: Session):
    user = session.info["user"]
    async with write(session, ("doctor",)):
        case = await find(session, Case, organization, case_id, lock=True)
        existing = await session.scalar(select(IhcReview).where(IhcReview.organization == organization, IhcReview.case_id == case_id,
            IhcReview.created_by == str(user.id), IhcReview.request_key == key))
        values = data.model_dump(exclude={"version"})
        if existing:
            if existing.version != data.version + 1 or any(getattr(existing, field) != value for field, value in values.items()):
                raise HTTPException(409, "This review key was already used with different details.")
            return review_view(existing)
        scan = (await session.execute(scan_choices(case).where(SlideScan.id == data.scan_id))).one_or_none()
        if scan is None or (marker := marker_for(scan.stain)) not in MARKERS:
            raise HTTPException(422, "Choose an available IHC scan in this case.")
        block = await session.scalar(select(SpecimenBlock).where(SpecimenBlock.id == data.block_id,
            SpecimenBlock.organization == organization, SpecimenBlock.specimen_id == scan.specimen_id))
        if block is None:
            raise HTTPException(422, "Select a best block from the scan’s specimen.")
        if data.run_id and not await session.scalar(select(AnalysisRun.id).where(
            AnalysisRun.organization == organization, AnalysisRun.case_id == case_id, AnalysisRun.id == data.run_id,
            AnalysisRun.scan_id == data.scan_id, AnalysisRun.marker == marker, AnalysisRun.status == "completed")):
            raise HTTPException(422, "Select a completed model run for this scan and marker.")
        prior = await session.scalar(select(IhcReview).where(IhcReview.organization == organization,
            IhcReview.specimen_id == scan.specimen_id, IhcReview.marker == marker).order_by(IhcReview.version.desc()).limit(1))
        version = prior.version if prior else 0
        if data.version != version:
            raise HTTPException(409, "The IHC review changed. Reload before saving a revision.")
        row = IhcReview(organization=organization, case_id=case_id, specimen_id=scan.specimen_id,
            marker=marker, block_number=block.block_number, version=version + 1,
            request_key=key, created_by=str(user.id), **values)
        session.add(row)
        await session.flush()
        add_event(session, row, "ihc_review_revised" if prior else "ihc_review_recorded",
                  review_view(prior) if prior else {}, review_view(row), data.rationale, source="analysis")
        return review_view(row)
