"""Institution-scoped configuration, inbound queue, and explicit patient reconciliation."""

import asyncio
from datetime import date
from types import SimpleNamespace
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth import WRITERS, require_roles
from app.clinical import (ClinicalInput, Organization, PatientCreate, Reason, Session, add_event, find,
                          public_fields, relationship_state, require_version, write)
from app.connectors import AdapterUnavailable, invoke
from app.integration_service import (KIND, SYSTEM, digest, identifier_query, now, patient_differences,
                                     set_connection_state, snapshot_key)
from app.models import Case, ExternalIdentifier, ExternalSnapshot, IntegrationConnection, IntegrationMessage, Patient
from app.patient_history import HistoryDocument

router = APIRouter(prefix="/api/integration/{organization}", tags=["EMR and LIS"])
Channel = Literal["emr", "lis"]
Resource = Literal["patient", "case", "specimen", "slide"]
ExternalId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Version = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class Config(ClinicalInput):
    version: int = Field(ge=0)
    mode: Literal["not_configured", "disabled", "mock"]
    scenario: Literal["normal", "unavailable", "timeout"] = "normal"


class PatientPayload(ClinicalInput):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    birth_date: date | None = None


class LisPayload(ClinicalInput):
    external_state: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class HistoryPayload(HistoryDocument):
    patient_external_id: ExternalId


class Envelope(ClinicalInput):
    message_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
    resource: Resource | Literal["history"]
    external_id: ExternalId
    revision: Version
    data: PatientPayload | LisPayload | HistoryPayload


class PatientLookup(ClinicalInput):
    external_id: ExternalId


class PatientConfirmation(PatientLookup):
    case_version: Version
    patient_version: Version
    source_revision: Version
    confirm_differences: bool = False
    reason: Reason


class ManualPatient(PatientCreate):
    case_version: Version


def connection_view(row, channel):
    if row is None:
        return {"channel": channel, "mode": "not_configured", "state": "not_configured", "scenario": "normal",
                "version": 0, "checked_at": None, "last_success_at": None}
    return {"channel": channel, "mode": row.mode, "state": row.state, "scenario": row.scenario,
            "version": row.version, "checked_at": row.checked_at, "last_success_at": row.last_success_at}


def message_view(row):
    return {key: getattr(row, key) for key in (
        "id", "channel", "message_id", "state", "attempts", "delivery_conflicts",
        "next_attempt_at", "received_at", "finished_at", "error",
    )}


@router.get("/status")
async def status(organization: Organization, session: Session):
    return {channel: connection_view(await session.get(IntegrationConnection, (organization, channel)), channel)
            for channel in SYSTEM}


@router.put("/connections/{channel}")
async def configure(organization: Organization, channel: Channel, data: Config, session: Session):
    async with write(session, ("admin",)):
        row = await session.get(IntegrationConnection, (organization, channel), with_for_update=True)
        if (row.version if row else 0) != data.version:
            raise HTTPException(409, "Integration settings have changed. Refresh and try again.")
        if row is None:
            row = IntegrationConnection(organization=organization, channel=channel, version=0)
            session.add(row)
        row.mode, row.scenario = data.mode, data.scenario if data.mode == "mock" else "normal"
        row.state = "configured" if data.mode == "mock" else data.mode
        row.checked_at = None
        row.version += 1
        return connection_view(row, channel)


async def online_config(session, organization, channel):
    row = await session.get(IntegrationConnection, (organization, channel))
    if row is None or row.mode != "mock":
        raise HTTPException(409, "This integration is disabled or not configured.")
    return SimpleNamespace(**{key: getattr(row, key) for key in ("organization", "channel", "mode", "scenario", "version")})


async def request_adapter(session, config, operation, *args):
    # The network wait is deliberately outside the clinical or inbox transaction.
    await session.rollback()
    error = None
    result = None
    try:
        result = await invoke(config, operation, *args)
    except (asyncio.TimeoutError, AdapterUnavailable):
        error = "unavailable"
    async with session.begin():
        current = await set_connection_state(session, config, error)
    if not current:
        raise HTTPException(409, "Integration settings have changed. Refresh and try again.")
    if error:
        raise HTTPException(503, "The external system is not responding. You can continue registering records locally.")
    return result


@router.post("/connections/{channel}/probe")
async def probe(organization: Organization, channel: Channel, session: Session):
    require_roles(session.info["user"], ("admin",))
    config = await online_config(session, organization, channel)
    await request_adapter(session, config, "probe")
    return connection_view(await session.get(IntegrationConnection, (organization, channel)), channel)


@router.post("/connections/{channel}/messages", status_code=202)
async def receive(organization: Organization, channel: Channel, data: Envelope, session: Session):
    if data.resource == "history":
        valid = isinstance(data.data, HistoryPayload)
    elif data.resource == "patient":
        valid = channel == "emr" and isinstance(data.data, PatientPayload)
    else:
        valid = channel == "lis" and isinstance(data.data, LisPayload)
    if not valid:
        raise HTTPException(422, "This message type is unsupported for the channel.")
    payload = data.model_dump(mode="json")
    fingerprint = digest(payload)
    conflict = False
    async with write(session, ("admin",)):
        lookup = select(IntegrationMessage).where(
            IntegrationMessage.organization == organization, IntegrationMessage.channel == channel,
            IntegrationMessage.message_id == data.message_id,
        ).with_for_update()
        row = await session.scalar(lookup)
        record_id = None
        if row is None:
            await online_config(session, organization, channel)
            record_id = await session.scalar(insert(IntegrationMessage).values(
                organization=organization, channel=channel, message_id=data.message_id, payload=payload, digest=fingerprint,
                state="queued", next_attempt_at=now(),
            ).on_conflict_do_nothing().returning(IntegrationMessage.id))
            row = await session.scalar(lookup)
        if row.digest != fingerprint:
            row.delivery_conflicts += 1
            conflict = True
        result = {**message_view(row), "duplicate": record_id is None}
    if conflict:
        raise HTTPException(409, "A message with the same ID arrived with different content.")
    return result


@router.get("/messages")
async def messages(organization: Organization, session: Session):
    require_roles(session.info["user"], ("admin",))
    rows = await session.scalars(select(IntegrationMessage).where(
        IntegrationMessage.organization == organization,
    ).order_by(IntegrationMessage.received_at.desc(), IntegrationMessage.id).limit(100))
    return [message_view(row) for row in rows]


@router.post("/messages/{record_id}/retry")
async def retry(organization: Organization, record_id: UUID, session: Session):
    async with write(session, ("admin",)):
        row = await session.get(IntegrationMessage, record_id, with_for_update=True)
        if row is None or row.organization != organization:
            raise HTTPException(404, "Incoming message not found.")
        if row.state not in ("dead_letter", "retry_wait"):
            raise HTTPException(409, "This message cannot be reprocessed in its current status.")
        await online_config(session, organization, row.channel)
        row.state, row.attempts, row.error, row.finished_at = "queued", 0, None, None
        row.next_attempt_at = now()
        return message_view(row)


@router.get("/sources/{resource}/{record_id}")
async def source_for(organization: Organization, resource: Resource, record_id: UUID, session: Session):
    from app.clinical import MODELS
    await find(session, MODELS[resource + "s"], organization, record_id)
    channel = "emr" if resource == "patient" else "lis"
    owner = getattr(ExternalIdentifier, resource + "_id")
    rows = await session.execute(select(ExternalIdentifier, ExternalSnapshot)
        .outerjoin(ExternalSnapshot, (ExternalSnapshot.organization == ExternalIdentifier.organization)
                   & (ExternalSnapshot.channel == channel) & (ExternalSnapshot.resource == resource)
                   & (ExternalSnapshot.external_id == ExternalIdentifier.value))
        .where(ExternalIdentifier.organization == organization, owner == record_id,
               ExternalIdentifier.system == SYSTEM[channel], ExternalIdentifier.kind == KIND[resource]))
    return [{"external_id": identity.value, "system": identity.system, "state": identity.connection_state,
             "last_synced_at": identity.last_synced_at, "source_revision": snapshot.revision if snapshot else None,
             "external_state": snapshot.payload.get("external_state") if snapshot else None} for identity, snapshot in rows]


@router.post("/cases/{case_id}/manual-patient", status_code=201)
async def manual_patient(organization: Organization, case_id: UUID, data: ManualPatient, session: Session):
    async with write(session):
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.case_version)
        if case.patient_id:
            raise HTTPException(409, "This case already has a linked patient record.")
        patient = Patient(organization=organization, created_by=str(session.info["user"].id), source="manual",
                          **data.model_dump(exclude={"case_version"}))
        session.add(patient)
        await session.flush()
        transaction = uuid4()
        before = relationship_state(case)
        case.patient_id = patient.id
        case.version += 1
        add_event(session, patient, "registered", {}, {}, transaction_id=transaction)
        add_event(session, case, "patient_id_changed", before, relationship_state(case), transaction_id=transaction)
        return public_fields(patient)


@router.post("/cases/{case_id}/patient-lookup")
async def patient_lookup(organization: Organization, case_id: UUID, data: PatientLookup, session: Session):
    require_roles(session.info["user"], WRITERS)
    case = await find(session, Case, organization, case_id)
    config = await online_config(session, organization, "emr")
    local_id, case_version = case.patient_id, case.version
    key = snapshot_key(organization, "emr", "patient", data.external_id)
    candidate = await session.get(ExternalSnapshot, key)
    source = ({"data": candidate.payload, "revision": candidate.revision, "received_at": candidate.received_at}
              if candidate is not None else None)
    source = await request_adapter(session, config, "lookup_patient", source)
    if source is None:
        return {"match": "not_found"}
    local = await session.get(Patient, local_id) if local_id else None
    existing = await session.scalar(identifier_query(*key))
    conflict = bool(existing and (local_id is None or existing.patient_id != local_id))
    return {"match": "conflict" if conflict else "found", "external_id": data.external_id, "case_version": case_version,
            "patient_version": local.version if local else None, "differences": patient_differences(local, source["data"]),
            "link_state": existing.connection_state if existing and not conflict else None, **source}


@router.post("/cases/{case_id}/patient-confirm")
async def confirm_patient(organization: Organization, case_id: UUID, data: PatientConfirmation, session: Session):
    async with write(session):
        case = await find(session, Case, organization, case_id, lock=True)
        require_version(case, data.case_version)
        if case.patient_id is None:
            raise HTTPException(409, "Register a patient record manually for the case first.")
        key = snapshot_key(organization, "emr", "patient", data.external_id)
        candidate = await session.get(ExternalSnapshot, key, with_for_update=True)
        if candidate is None or candidate.revision != data.source_revision:
            raise HTTPException(409, "The external record has changed. Reconcile it again.")
        patient = await find(session, Patient, organization, case.patient_id, lock=True)
        require_version(patient, data.patient_version)
        differences = patient_differences(patient, candidate.payload)
        if differences and not data.confirm_differences:
            raise HTTPException(409, "Review the differences before confirming the link.")
        existing = await session.scalar(identifier_query(*key).with_for_update())
        if existing is not None and existing.patient_id != patient.id:
            raise HTTPException(409, "This external identifier is linked to another record.")
        # An external snapshot can be reviewed while offline; the UI labels its receive time.
        if existing is None:
            existing = ExternalIdentifier(organization=organization, system=SYSTEM["emr"], kind=KIND["patient"],
                                          value=data.external_id, patient_id=patient.id, source="emr",
                                          linked_by=str(session.info["user"].id), first_received_at=candidate.first_received_at)
            session.add(existing)
        elif existing.source == "emr" and existing.connection_state == "linked" and existing.last_synced_at == candidate.received_at:
            return public_fields(existing)
        existing.source = "emr"
        existing.connection_state, existing.last_synced_at = "linked", candidate.received_at
        patient.version += 1
        await session.flush()
        add_event(session, patient, "emr_patient_linked", {}, {"identifier_id": str(existing.id),
                  "source_revision": candidate.revision, "confirmed_differences": differences}, data.reason, source="emr")
        return public_fields(existing)
