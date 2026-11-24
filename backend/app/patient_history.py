"""Case-scoped access to local notes and previously received clinical documents."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, StringConstraints
from sqlalchemy import Date, String, cast, func, literal, select, union_all
from sqlalchemy.dialects.postgresql import insert

from app.auth import require_roles
from app.clinical import (ClinicalInput, Organization, RegistrationKey, Session, add_event,
                          find, require_version, write)
from app.integration_service import KIND, SYSTEM
from app.models import AuthUser, Case, ExternalIdentifier, ExternalSnapshot, IntegrationConnection, PatientHistoryRecord

router = APIRouter(prefix="/api/clinical/{organization}/cases/{case_id}/patient-history", tags=["Patient history"])
HISTORY_ROLES = ("admin", "doctor")
Kind = Literal["diagnostic_report", "encounter_note"]
Source = Literal["manual", "emr", "lis"]


class HistoryDocument(ClinicalInput):
    kind: Kind
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12000)]
    occurred_on: date


class ManualHistory(HistoryDocument):
    case_version: Annotated[int, Field(ge=1)]


def patient_links(case):
    return select(ExternalIdentifier).where(
        ExternalIdentifier.organization == case.organization, ExternalIdentifier.patient_id == case.patient_id,
        ExternalIdentifier.system == SYSTEM["emr"], ExternalIdentifier.kind == KIND["patient"],
    )


def confirmed_links(case):
    return patient_links(case).where(
        ExternalIdentifier.source == "emr", ExternalIdentifier.connection_state == "linked",
        ExternalIdentifier.last_synced_at.is_not(None),
    ).with_only_columns(ExternalIdentifier.value)


def manual_documents(case):
    manual = PatientHistoryRecord
    return select(
        cast(manual.id, String).label("id"), literal("manual").label("source"), manual.kind, manual.title,
        manual.occurred_on, manual.created_at.label("recorded_at"), manual.version.label("revision"),
    ).where(manual.organization == case.organization, manual.patient_id == case.patient_id)


def external_documents(case):
    source = ExternalSnapshot
    # Keep source document identifiers out of URLs and web access logs.
    key = func.encode(func.sha256(func.convert_to(source.external_id, "UTF8")), "hex")
    return select(
        key.label("id"), source.channel.label("source"), source.payload["kind"].astext.label("kind"),
        source.payload["title"].astext.label("title"), cast(source.payload["occurred_on"].astext, Date).label("occurred_on"),
        source.received_at.label("recorded_at"), source.revision,
    ).where(
        source.organization == case.organization, source.resource == "history", source.channel.in_(SYSTEM),
        source.payload["patient_external_id"].astext.in_(confirmed_links(case)),
    )


@router.get("")
async def list_history(
    organization: Organization, case_id: UUID, session: Session,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    require_roles(session.info["user"], HISTORY_ROLES)
    case = await find(session, Case, organization, case_id)
    records = []
    received = {}
    match = "no_patient"
    if case.patient_id:
        linked = await session.scalar(select(confirmed_links(case).exists()))
        review = await session.scalar(select(patient_links(case).where(ExternalIdentifier.connection_state == "needs_review").exists()))
        match = "needs_review" if review else "linked" if linked else "not_linked"
        combined = union_all(manual_documents(case), external_documents(case)).subquery()
        records = (await session.execute(
            select(combined).order_by(combined.c.occurred_on.desc(), combined.c.recorded_at.desc(),
                                      combined.c.source, combined.c.id).offset(offset).limit(21)
        )).mappings().all()
        if linked:
            external = external_documents(case).subquery()
            received = dict((await session.execute(
                select(external.c.source, func.max(external.c.recorded_at)).group_by(external.c.source)
            )).all())
    connections = {}
    for channel in SYSTEM:
        connection = await session.get(IntegrationConnection, (organization, channel))
        connections[channel] = {
            "state": connection.state if connection else "not_configured",
            "mode": connection.mode if connection else "not_configured",
            "checked_at": connection.checked_at if connection else None,
            "last_received_at": received.get(channel),
        }
    return {"match": match, "records": [dict(row) for row in records[:20]], "has_more": len(records) > 20,
            "connections": connections, "case_version": case.version}


@router.get("/document")
async def get_document(
    organization: Organization, case_id: UUID, source: Source,
    record_id: Annotated[str, Query(pattern=r"^[0-9a-f-]{36}$|^[0-9a-f]{64}$")], session: Session,
):
    require_roles(session.info["user"], HISTORY_ROLES)
    case = await find(session, Case, organization, case_id)
    result = None
    if case.patient_id and source == "manual":
        documents = manual_documents(case)
        result = (await session.execute(documents.add_columns(
            PatientHistoryRecord.body, AuthUser.display_name.label("author"),
        ).outerjoin(AuthUser, (AuthUser.organization == PatientHistoryRecord.organization)
                     & (cast(AuthUser.id, String) == PatientHistoryRecord.created_by))
            .where(documents.selected_columns.id == record_id))).mappings().one_or_none()
    elif case.patient_id:
        documents = external_documents(case)
        result = (await session.execute(documents.add_columns(ExternalSnapshot.payload["body"].astext.label("body"))
            .where(ExternalSnapshot.channel == source, documents.selected_columns.id == record_id))).mappings().one_or_none()
    if result is None:
        raise HTTPException(404, "Clinical record not found for this case.")
    return dict(result)


@router.post("", status_code=201)
async def create_manual(
    organization: Organization, case_id: UUID, data: ManualHistory, key: RegistrationKey, session: Session,
):
    creator = str(session.info["user"].id)
    fields = data.model_dump(exclude={"case_version"})
    async with write(session, HISTORY_ROLES):
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.case_version)
        if case.patient_id is None:
            raise HTTPException(409, "Link a local patient to this case before adding a clinical record.")
        identity = {"organization": organization, "created_by": creator, "request_key": key}
        record = await session.scalar(insert(PatientHistoryRecord).values(
            **identity, **fields, patient_id=case.patient_id, case_id=case.id,
        ).on_conflict_do_nothing().returning(PatientHistoryRecord))
        if record is None:
            record = await session.scalar(select(PatientHistoryRecord).filter_by(**identity))
            if (record.patient_id != case.patient_id or record.case_id != case.id
                    or any(getattr(record, name) != value for name, value in fields.items())):
                raise HTTPException(409, "This request ID was already used for a different clinical record.")
        else:
            add_event(session, record, "patient_history_recorded", {}, {"case_id": str(case.id), "kind": record.kind})
        return {"id": record.id, "source": "manual"}
