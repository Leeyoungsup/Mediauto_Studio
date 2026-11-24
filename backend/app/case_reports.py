"""Case report templates, immutable revisions, and an explicit LIS release step."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, StringConstraints, model_validator
from sqlalchemy import String, cast, select

from app.analysis_execution import review_view
from app.analysis_jobs import run_view
from app.auth import require_roles
from app.clinical import (ClinicalInput, Organization, Reason, Session, add_event, find,
                          require_version, write)
from app.integration_service import KIND, SYSTEM, digest, now
from app.lymph_counts import count_view
from app.models import (AnalysisRun, IhcReview, AuthUser, Case, CaseReport, CaseRequest, ExternalIdentifier, IntegrationConnection,
                        LymphNodeCount, ReportRevision, ReportTemplate, ReportTransmission, Specimen)
from app.report_delivery import approved_adapter, status_view, step

router = APIRouter(prefix="/api/clinical/{organization}", tags=["Case reports"])
REPORT_ROLES = ("admin", "doctor")
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Key = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
Body = Annotated[str, StringConstraints(strip_whitespace=True, max_length=12000)]
DEFAULT_TEMPLATE = {
    "id": None, "template_key": None, "name": "Surgical Pathology", "version": 1,
    "sections": [{"key": "diagnosis", "label": "Diagnosis", "required": True},
                 {"key": "microscopic", "label": "Microscopic Description", "required": False},
                 {"key": "comment", "label": "Comment", "required": False}],
}


class Section(ClinicalInput):
    key: Key
    label: Name
    required: bool = False


class TemplateInput(ClinicalInput):
    template_key: UUID | None = None
    version: Annotated[int, Field(ge=0)] = 0
    name: Name
    sections: Annotated[list[Section], Field(min_length=1, max_length=12)]

    @model_validator(mode="after")
    def distinct_fields(self):
        if len({item.key for item in self.sections}) != len(self.sections):
            raise ValueError("Use a different key for each section.")
        if len({item.label.casefold() for item in self.sections}) != len(self.sections):
            raise ValueError("Use a different label for each section.")
        return self


class DraftInput(ClinicalInput):
    version: Annotated[int, Field(ge=0)]
    template_id: UUID | None = None
    sections: Annotated[dict[Key, Body], Field(max_length=12)]
    evidence_ids: Annotated[list[UUID], Field(max_length=30)] = Field(default_factory=list)
    dictated_sections: Annotated[list[Key], Field(max_length=12)] = Field(default_factory=list)


class Version(ClinicalInput):
    version: Annotated[int, Field(ge=1)]


class ReportAction(Version):
    action: Literal["submit", "return", "approve", "correct"]
    reason: Reason | None = None
    reviewed: bool = False


def template_view(item):
    if item is None:
        return DEFAULT_TEMPLATE
    return {"id": str(item.id), "template_key": str(item.template_key), "name": item.name, "version": item.version,
            "sections": item.sections}


async def templates(session, organization):
    rows = (await session.scalars(select(ReportTemplate).where(ReportTemplate.organization == organization)
        .distinct(ReportTemplate.template_key).order_by(ReportTemplate.template_key, ReportTemplate.version.desc()))).all()
    return [DEFAULT_TEMPLATE, *sorted((template_view(row) for row in rows), key=lambda item: item["name"].casefold())]


@router.get("/report-templates")
async def list_templates(organization: Organization, session: Session):
    require_roles(session.info["user"], REPORT_ROLES)
    return await templates(session, organization)


@router.post("/report-templates", status_code=201)
async def register_template(organization: Organization, data: TemplateInput, session: Session):
    user = session.info["user"]
    async with write(session, ("admin",)):
        previous = None
        if data.template_key:
            previous = await session.scalar(select(ReportTemplate).where(
                ReportTemplate.organization == organization, ReportTemplate.template_key == data.template_key,
            ).order_by(ReportTemplate.version.desc()).limit(1))
            if previous is None:
                raise HTTPException(404, "Report template not found.")
        if (previous.version if previous else 0) != data.version:
            raise HTTPException(409, "The report template has changed. Reload the latest revision.")
        created = ReportTemplate(organization=organization, template_key=data.template_key or uuid4(),
                                 version=data.version + 1, name=data.name, created_by=user.id,
                                 sections=[section.model_dump() for section in data.sections])
        session.add(created)
        await session.flush()
        return template_view(created)


async def report_for(session, case):
    return await session.scalar(select(CaseReport).where(CaseReport.organization == case.organization,
                                                         CaseReport.case_id == case.id))


async def revision_at(session, report, version=None):
    if report is None:
        raise HTTPException(404, "No report has been started for this case.")
    revision = await session.scalar(select(ReportRevision).where(
        ReportRevision.organization == report.organization, ReportRevision.report_id == report.id,
        ReportRevision.version == (version if version is not None else report.version),
    ))
    if revision is None:
        raise HTTPException(404, "Report version not found.")
    return revision


def revision_view(row, author=None):
    return {
        "version": row.version, "status": row.status, "action": row.action, "author": author or row.author,
        "created_at": row.created_at, "reason": row.reason, "replaces_version": row.replaces_version,
        "correction_reason": row.correction_reason, **row.content,
    }


async def evidence_choices(session, case):
    rows = (await session.scalars(select(CaseRequest).where(
        CaseRequest.organization == case.organization, CaseRequest.case_id == case.id, CaseRequest.status == "completed",
    ).order_by(CaseRequest.updated_at.desc(), CaseRequest.id))).all()
    choices = [{"id": str(row.id), "kind": row.kind, "version": row.version, "completed_at": row.updated_at.isoformat(),
             "result_note": row.result_note, "snapshot": row.snapshot, "scan_id": str(row.scan_id) if row.scan_id else None}
            for row in rows if (row.kind == "ai" and row.snapshot) or (row.kind == "consult" and row.result_note)]

    counts = (await session.execute(select(LymphNodeCount, Specimen.specimen_number)
              .join(Specimen, (Specimen.organization == LymphNodeCount.organization) & (Specimen.id == LymphNodeCount.specimen_id))
              .where(Specimen.organization == case.organization, Specimen.case_id == case.id)
              .order_by(Specimen.specimen_number, LymphNodeCount.version.desc()))).all()
    seen = set()
    for row, specimen in counts:
        choices.append({**count_view(row), "kind": "lymph_node_count", "specimen": specimen,
                        "completed_at": row.created_at.isoformat(), "superseded": row.specimen_id in seen,
                        "result_note": None, "snapshot": None})
        seen.add(row.specimen_id)
    runs = await session.scalars(select(AnalysisRun).where(AnalysisRun.organization == case.organization,
        AnalysisRun.case_id == case.id, AnalysisRun.status == "completed").order_by(AnalysisRun.created_at.desc()))
    choices.extend({**run_view(run), "kind": "analysis_run", "version": run.attempt,
                    "completed_at": run.finished_at.isoformat(), "snapshot": run.result.get("snapshot"), "result_note": None}
                   for run in runs)
    reviews = await session.scalars(select(IhcReview).where(IhcReview.organization == case.organization,
        IhcReview.case_id == case.id).order_by(IhcReview.created_at.desc(), IhcReview.id))
    seen_reviews = set()
    for review in reviews:
        identity = (review.specimen_id, review.marker)
        choices.append({**review_view(review), "kind": "ihc_review", "completed_at": review.created_at.isoformat(),
                        "superseded": identity in seen_reviews, "snapshot": None, "result_note": review.rationale})
        seen_reviews.add(identity)
    return choices


async def case_accession(session, case):
    ids = (await session.scalars(select(ExternalIdentifier.value).where(
        ExternalIdentifier.organization == case.organization, ExternalIdentifier.case_id == case.id,
        ExternalIdentifier.system == SYSTEM["lis"], ExternalIdentifier.kind == KIND["case"],
        ExternalIdentifier.connection_state == "linked",
    ).limit(2))).all()
    return ids[0] if len(ids) == 1 else None


@router.get("/cases/{case_id}/report")
async def get_report(organization: Organization, case_id: UUID, session: Session):
    user = session.info["user"]
    require_roles(user, REPORT_ROLES)
    case = await find(session, Case, organization, case_id)
    report = await report_for(session, case)
    history, deliveries = [], []
    selected = None
    if report:
        scope = (ReportRevision.organization == organization, ReportRevision.report_id == report.id)
        author = select(AuthUser.display_name).where(
            AuthUser.organization == organization, cast(AuthUser.id, String) == ReportRevision.author,
        ).scalar_subquery()
        history = [dict(row) for row in (await session.execute(select(
            ReportRevision.version, ReportRevision.status, ReportRevision.action, ReportRevision.created_at,
            ReportRevision.reason, ReportRevision.replaces_version, author.label("author"),
        ).where(*scope).order_by(ReportRevision.version.desc()))).mappings()]
        selected = revision_view(await revision_at(session, report), history[0]["author"])
        deliveries = [status_view(row) for row in await session.scalars(select(ReportTransmission).where(
            ReportTransmission.organization == organization, ReportTransmission.report_id == report.id,
        ).order_by(ReportTransmission.report_version.desc()))]
    connection = await session.get(IntegrationConnection, (organization, "lis"))
    accession = await case_accession(session, case)
    return {
        "draft": selected, "history": history, "deliveries": deliveries,
        "templates": await templates(session, organization), "evidence": await evidence_choices(session, case),
        "can_approve": user.role == "doctor" and case.assigned_to == user.id,
        "can_manage_templates": user.role == "admin", "lis_enabled": approved_adapter(connection),
        "lis_accession_linked": accession is not None, "lis_accession": accession,
    }


@router.get("/cases/{case_id}/report/versions/{version}")
async def get_version(organization: Organization, case_id: UUID, version: int, session: Session):
    require_roles(session.info["user"], REPORT_ROLES)
    case = await find(session, Case, organization, case_id)
    row = await revision_at(session, await report_for(session, case), version)
    author = await session.scalar(select(AuthUser.display_name).where(
        AuthUser.organization == organization, AuthUser.id == UUID(row.author),
    ))
    return revision_view(row, author)


async def append_revision(session, report, content, status, action, previous=None, *,
                          reason=None, replaces=None, correction_reason=None):
    if previous:
        report.version += 1
    row = ReportRevision(
        organization=report.organization, report_id=report.id, version=report.version, status=status, action=action,
        content=content, author=str(session.info["user"].id), reason=reason,
        replaces_version=replaces if replaces is not None else previous.replaces_version if previous else None,
        correction_reason=correction_reason if correction_reason is not None else previous.correction_reason if previous else None,
    )
    session.add(row)
    add_event(session, report, action, {"status": previous.status, "report_version": previous.version} if previous else {},
              {"status": status, "report_version": report.version, "replaces_version": row.replaces_version,
               "evidence_ids": [item["id"] for item in content["evidence"]], "dictated_sections": content["dictated_sections"]},
              reason, source="ims")
    await session.flush()
    return revision_view(row, session.info["user"].display_name)


@router.put("/cases/{case_id}/report")
async def save_draft(organization: Organization, case_id: UUID, data: DraftInput, session: Session):
    async with write(session, REPORT_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        report = await report_for(session, case)
        previous = None
        if report is not None:
            require_version(report, data.version)
            previous = await revision_at(session, report)
            if previous.status != "draft":
                raise HTTPException(409, "Only a draft can be edited.")
        elif data.version != 0:
            raise HTTPException(409, "Reload the latest report version.")

        template = DEFAULT_TEMPLATE
        if data.template_id is not None:
            selected = await session.scalar(select(ReportTemplate).where(
                ReportTemplate.organization == organization, ReportTemplate.id == data.template_id))
            if selected is None:
                raise HTTPException(404, "Report template not found.")
            template = template_view(selected)
        keys = {item["key"] for item in template["sections"]}
        if set(data.sections) - keys or set(data.dictated_sections) - keys:
            raise HTTPException(422, "Report fields must belong to the selected template.")
        if sum(len(value) for value in data.sections.values()) > 48000:
            raise HTTPException(422, "The combined report text exceeds 48,000 characters.")
        choices = {item["id"]: item for item in await evidence_choices(session, case)}
        selected_ids = list(dict.fromkeys(map(str, data.evidence_ids)))
        if set(selected_ids) - choices.keys():
            raise HTTPException(422, "Select completed results that belong to this case.")
        selected = [{field: value for field, value in choices[key].items() if field != "superseded"} for key in selected_ids]
        specimens = [entry["specimen_id"] for entry in selected if entry["kind"] == "lymph_node_count"]
        if len(specimens) != len(set(specimens)):
            raise HTTPException(422, "Select one lymph node count version per specimen.")
        reviews = [(entry["specimen_id"], entry["marker"]) for entry in selected if entry["kind"] == "ihc_review"]
        if len(reviews) != len(set(reviews)):
            raise HTTPException(422, "Select one IHC review version per specimen and marker.")
        content = {"template": template, "sections": {key: data.sections.get(key, "") for key in sorted(keys)},
                   "evidence": selected, "dictated_sections": sorted(set(data.dictated_sections))}
        if previous and content == previous.content:
            return revision_view(previous)
        if report is None:
            report = CaseReport(organization=organization, case_id=case.id, created_by=str(session.info["user"].id))
            session.add(report)
            await session.flush()
        return await append_revision(session, report, content, "draft", "report_draft_saved", previous)


@router.post("/cases/{case_id}/report/actions")
async def act_report(organization: Organization, case_id: UUID, data: ReportAction, session: Session):
    user = session.info["user"]
    async with write(session, REPORT_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        report = await report_for(session, case)
        current = await revision_at(session, report)
        require_version(report, data.version)
        expected, target = {"submit": ("draft", "in_review"), "return": ("in_review", "draft"),
                            "approve": ("in_review", "approved"), "correct": ("approved", "draft")}[data.action]
        if current.status != expected:
            raise HTTPException(409, "This action is unavailable for the current report status.")
        if data.action in ("approve", "return") and (user.role != "doctor" or case.assigned_to != user.id):
            raise HTTPException(403, "The assigned pathologist must review this report.")
        if data.action == "approve" and not data.reviewed:
            raise HTTPException(422, "Confirm that you reviewed the report and its evidence.")
        if data.action in ("return", "correct") and not data.reason:
            raise HTTPException(422, "Enter a reason for this change.")
        if data.action == "submit" and (not any(current.content["sections"].values()) or any(
            section["required"] and not current.content["sections"].get(section["key"])
            for section in current.content["template"]["sections"]
        )):
            raise HTTPException(422, "Complete the required report sections before submitting.")
        if data.action == "correct":
            delivery = await session.scalar(select(ReportTransmission).where(
                ReportTransmission.revision_id == current.id, ReportTransmission.organization == organization).with_for_update())
            if delivery is not None and delivery.status != "acknowledged":
                raise HTTPException(409, "Resolve the previous LIS delivery before starting a correction.")
        action = {"submit": "report_submitted", "return": "report_returned",
                  "approve": "report_approved", "correct": "report_correction_started"}[data.action]
        return await append_revision(session, report, current.content, target, action, current,
            reason=data.reason, replaces=current.version if data.action == "correct" else None,
            correction_reason=data.reason if data.action == "correct" else None)


@router.post("/cases/{case_id}/report/send", status_code=202)
async def send_report(organization: Organization, case_id: UUID, data: Version, session: Session):
    async with write(session, REPORT_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        report = await report_for(session, case)
        current = await revision_at(session, report)
        require_version(report, data.version)
        if current.status != "approved":
            raise HTTPException(409, "Approve the report before sending it to LIS.")
        prior = await session.scalar(select(ReportTransmission).where(
            ReportTransmission.organization == organization, ReportTransmission.revision_id == current.id))
        if prior is not None:
            return status_view(prior)
        connection = await session.get(IntegrationConnection, (organization, "lis"))
        if not approved_adapter(connection):
            raise HTTPException(409, "Enable the approved LIS development adapter before sending.")
        accession = await case_accession(session, case)
        if accession is None:
            raise HTTPException(409, "Link one LIS accession to this case before sending a report.")
        previous = await session.scalar(select(ReportTransmission).where(
            ReportTransmission.organization == organization, ReportTransmission.report_id == report.id,
            ReportTransmission.status == "acknowledged",
        ).order_by(ReportTransmission.report_version.desc()).limit(1))
        payload = {"report_id": str(report.id), "report_version": current.version, "accession": accession,
                   "kind": "correction" if previous else "initial", "previous_ack": previous.ack_id if previous else None,
                   "correction_reason": current.correction_reason,
                   "sections": [{"label": section["label"], "text": current.content["sections"][section["key"]]}
                                for section in current.content["template"]["sections"]]}
        sent = ReportTransmission(organization=organization, case_id=case.id, report_id=report.id,
                                  revision_id=current.id, report_version=current.version, status="queued",
                                  payload=payload, digest=digest(payload), created_by=str(session.info["user"].id))
        session.add(sent)
        await session.flush()
        add_event(session, sent, "report_delivery_queued", {}, {"status": "queued", "report_version": current.version}, source="ims")
        return status_view(sent)


@router.post("/cases/{case_id}/report/retry", status_code=202)
async def retry_report(organization: Organization, case_id: UUID, data: Version, session: Session):
    async with write(session, REPORT_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        report = await report_for(session, case)
        current = await revision_at(session, report)
        require_version(report, data.version)
        row = await session.scalar(select(ReportTransmission).where(
            ReportTransmission.organization == organization, ReportTransmission.revision_id == current.id,
        ).with_for_update())
        if row is None or row.status != "failed":
            raise HTTPException(409, "Only a failed delivery can be retried.")
        if not approved_adapter(await session.get(IntegrationConnection, (organization, "lis"))):
            raise HTTPException(409, "Enable the approved LIS development adapter before retrying.")
        row.status, row.error, row.ack_id, row.attempts = "queued", None, None, 0
        row.due_at, row.finished_at = now(), None
        step(session, row, "report_delivery_requeued", "failed")
        return status_view(row)
