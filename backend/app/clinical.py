import asyncio
import hashlib
import json
import stat
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Path as RoutePath, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, Session as DatabaseSession, WRITERS, require_organization, require_roles
from app.intake import DATA_ROOT
from app.models import Case, ClinicalEvent, ExternalIdentifier, Patient, RegistrationRequest, Slide, SlideScan, Specimen

SOURCE = "manual"
Organization = Annotated[str, RoutePath(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
RegistrationKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]
Number = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
Category = Literal["patients", "cases", "specimens", "slides", "scans"]
IdentityCategory = Literal["patients", "cases", "specimens", "slides"]
MODELS = {"patients": Patient, "cases": Case, "specimens": Specimen, "slides": Slide, "scans": SlideScan}
PARENT_FIELDS = {"cases": Case.patient_id, "specimens": Specimen.case_id, "slides": Slide.specimen_id, "scans": SlideScan.slide_id}


router = APIRouter(prefix="/api/clinical/{organization}", tags=["Clinical records"])


class ClinicalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


Sex = Literal["female", "male", "intersex", "other", "unknown"]


class PatientCreate(ClinicalInput):
    display_name: Name | None = None
    local_reference: Number | None = None
    birth_date: date | None = None
    sex: Sex | None = None

    @model_validator(mode="after")
    def minimum_identity(self):
        if not (self.display_name or self.local_reference):
            raise ValueError("Enter a patient name or local patient ID.")
        return self


class CaseCreate(ClinicalInput):
    case_number: Number
    accessioned_at: AwareDatetime | None = None
    patient_id: UUID | None = None


class SpecimenCreate(ClinicalInput):
    case_id: UUID
    specimen_number: Number
    collection_date: date | None = None
    description: Description | None = None


class SlideCreate(ClinicalInput):
    slide_number: Number
    specimen_id: UUID | None = None
    stain: Number | None = None


class ScanCreate(ClinicalInput):
    slide_id: UUID
    storage_key: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]


class LinkChange(ClinicalInput):
    target_id: UUID | None
    version: int = Field(ge=1)
    reason: Reason


class AccessionChange(ClinicalInput):
    version: int = Field(ge=1)
    accessioned_at: AwareDatetime | None


class CollectionChange(ClinicalInput):
    version: int = Field(ge=1)
    collection_date: date | None


class IdentifierQuery(ClinicalInput):
    system: Name
    kind: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    value: Description


class IdentifierLink(IdentifierQuery):
    version: int = Field(ge=1)
    reason: Reason


async def scoped_session(organization: Organization, user: CurrentUser, session: DatabaseSession):
    require_organization(user, organization)
    session.info["user"] = user
    return session


Session = Annotated[AsyncSession, Depends(scoped_session)]


@asynccontextmanager
async def write(session: AsyncSession, roles=WRITERS):
    require_roles(session.info["user"], roles)
    try:
        async with session.begin():
            yield
    except IntegrityError as exc:
        raise HTTPException(409, "This identifier or file is already registered, or a record link has changed.") from exc


def public_fields(record) -> dict:
    result = {column.key: getattr(record, column.key) for column in record.__table__.columns}
    if isinstance(record, SlideScan):
        result["modified_ns"] = str(record.modified_ns)
    return result


async def find(session: AsyncSession, model, organization: str, record_id: UUID, lock=False):
    statement = select(model).where(model.organization == organization, model.id == record_id)
    statement = statement.where(case_visibility(model, session.info["user"]))
    if lock:
        statement = statement.with_for_update()
    record = await session.scalar(statement)
    if record is None:
        raise HTTPException(404, "Record not found in this organization.")
    return record


def case_visibility(model, user):
    if user.role in WRITERS:
        return True
    assigned = (Case.organization == user.organization, Case.assigned_to == user.id)
    if model is Case:
        return Case.assigned_to == user.id
    if model is Patient:
        return Patient.id.in_(select(Case.patient_id).where(*assigned))
    specimens = select(Specimen.id).where(Specimen.case_id.in_(select(Case.id).where(*assigned)))
    if model is Specimen:
        return Specimen.id.in_(specimens)
    slides = select(Slide.id).where(Slide.specimen_id.in_(specimens))
    return Slide.id.in_(slides) if model is Slide else SlideScan.slide_id.in_(slides)


def add_event(session: AsyncSession, record, action: str, before: dict, after: dict, reason: str | None = None,
              *, source: str = SOURCE, transaction_id: UUID | None = None) -> None:
    session.add(ClinicalEvent(
        organization=record.organization, record_type=record.__tablename__, record_id=record.id,
        version=record.version, action=action, actor=str(session.info["user"].id), source=source, before=before, after=after,
        reason=reason, transaction_id=transaction_id or uuid4(),
    ))


def relationship_state(record) -> dict:
    state = {}
    for field in ("status", "assigned_to", "patient_id", "case_id", "specimen_id", "slide_id", "block_id", "block_number", "barcode", "accessioned_at", "collection_date", "group_key", "priority", "priority_source"):
        if hasattr(record, field):
            value = getattr(record, field)
            if field in ("block_id", "block_number", "barcode") and value is None:
                continue
            state[field] = str(value) if isinstance(value, UUID) else value.isoformat() if isinstance(value, date) else value
    return state


def scan_metadata(storage_key: str, data_root: Path | None = None) -> dict:
    path = Path(storage_key)
    if path.is_absolute() or "\\" in storage_key or "\0" in storage_key or ".." in path.parts:
        raise HTTPException(422, "Enter a WSI path relative to the data/ directory.")
    if path.suffix.lower() not in {".ndpi", ".svs"}:
        raise HTTPException(422, "Select an NDPI or SVS file.")
    root = (data_root or DATA_ROOT).resolve()
    candidate = root / path
    try:
        resolved = candidate.resolve(strict=True)
        if candidate != resolved or not resolved.is_relative_to(root):
            raise HTTPException(422, "Files must be located under data/. Symbolic links are unsupported.")
        metadata = resolved.stat()
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(404, "WSI file not found.") from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(422, "Check the WSI file path.") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise HTTPException(422, "Select a WSI file.")
    return {
        "storage_key": path.as_posix(), "format": path.suffix[1:].upper(),
        "size_bytes": metadata.st_size, "modified_ns": metadata.st_mtime_ns,
    }


async def register(session: AsyncSession, organization: str, model, key: str, data: BaseModel, parent=None) -> dict:
    payload = data.model_dump(mode="json")
    request_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    record_id = uuid4()
    operation = model.__tablename__

    async with write(session):
        reservation = insert(RegistrationRequest).values(
            organization=organization, operation=operation, request_key=key, request_hash=request_hash, record_id=record_id,
        ).on_conflict_do_nothing().returning(RegistrationRequest.record_id)
        if await session.scalar(reservation) is None:
            existing = await session.get(RegistrationRequest, (organization, operation, key))
            if existing.request_hash != request_hash:
                raise HTTPException(409, "This Idempotency-Key was already used for a different request.")
            return public_fields(await find(session, model, organization, existing.record_id))

        if parent is not None and parent[1] is not None:
            await find(session, parent[0], organization, parent[1])
        fields = data.model_dump()
        if model is Patient:
            fields["source"] = SOURCE
        elif model is Slide:
            fields["status"] = "registered" if data.specimen_id else "unlinked"
        elif model is SlideScan:
            fields.update(await asyncio.to_thread(scan_metadata, data.storage_key))
        record = model(id=record_id, organization=organization, created_by=str(session.info["user"].id), **fields)
        session.add(record)
        await session.flush()
        add_event(session, record, "registered", {}, relationship_state(record))
        return public_fields(record)


@router.post("/patients", status_code=201)
async def create_patient(organization: Organization, data: PatientCreate, key: RegistrationKey, session: Session):
    return await register(session, organization, Patient, key, data)


@router.post("/cases", status_code=201)
async def create_case(organization: Organization, data: CaseCreate, key: RegistrationKey, session: Session):
    return await register(session, organization, Case, key, data, (Patient, data.patient_id))


@router.post("/specimens", status_code=201)
async def create_specimen(organization: Organization, data: SpecimenCreate, key: RegistrationKey, session: Session):
    return await register(session, organization, Specimen, key, data, (Case, data.case_id))


@router.post("/slides", status_code=201)
async def create_slide(organization: Organization, data: SlideCreate, key: RegistrationKey, session: Session):
    return await register(session, organization, Slide, key, data, (Specimen, data.specimen_id))


@router.post("/scans", status_code=201)
async def create_scan(organization: Organization, data: ScanCreate, key: RegistrationKey, session: Session):
    return await register(session, organization, SlideScan, key, data, (Slide, data.slide_id))


async def update_worklist_date(session, organization, model, record_id, field, value, version):
    async with write(session):
        row = await find(session, model, organization, record_id, lock=True)
        require_version(row, version)
        if getattr(row, field) != value:
            before = relationship_state(row)
            setattr(row, field, value)
            row.version += 1
            add_event(session, row, field + "_changed", before, relationship_state(row), source="ims")
        return public_fields(row)


@router.patch("/cases/{case_id}/accessioned-at")
async def change_accession(organization: Organization, case_id: UUID, data: AccessionChange, session: Session):
    return await update_worklist_date(session, organization, Case, case_id, "accessioned_at", data.accessioned_at, data.version)


@router.patch("/specimens/{specimen_id}/collection-date")
async def change_collection(organization: Organization, specimen_id: UUID, data: CollectionChange, session: Session):
    return await update_worklist_date(session, organization, Specimen, specimen_id, "collection_date", data.collection_date, data.version)


@router.get("/{category}")
async def list_records(
    organization: Organization, category: Category, session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 50, offset: Annotated[int, Query(ge=0)] = 0,
    parent_id: UUID | None = None, unlinked: bool = False,
):
    model = MODELS[category]
    statement = select(model).where(model.organization == organization, case_visibility(model, session.info["user"]))
    if parent_id is not None or unlinked:
        parent_field = PARENT_FIELDS.get(category)
        if parent_field is None or (unlinked and (category not in {"cases", "slides"} or parent_id is not None)):
            raise HTTPException(422, "This relationship filter does not apply to the list.")
        statement = statement.where(parent_field == parent_id)
    records = await session.scalars(statement.order_by(model.created_at.desc(), model.id).offset(offset).limit(limit))
    return [public_fields(record) for record in records]


@router.get("/{category}/{record_id}")
async def get_record(organization: Organization, category: Category, record_id: UUID, session: Session):
    return public_fields(await find(session, MODELS[category], organization, record_id))


def require_version(record, version: int) -> None:
    if record.version != version:
        raise HTTPException(409, "The record has changed. Reload the latest version and try again.")


async def change_link(session: AsyncSession, organization: str, model, parent, field: str, record_id: UUID, data: LinkChange):
    async with write(session):
        record = await find(session, model, organization, record_id, lock=True)
        require_version(record, data.version)
        if getattr(record, field) == data.target_id:
            return public_fields(record)
        if data.target_id is not None:
            await find(session, parent, organization, data.target_id)
        before = relationship_state(record)
        setattr(record, field, data.target_id)
        if model is Slide:
            record.block_id = None
            record.status = "registered" if data.target_id else "unlinked"
        record.version += 1
        add_event(session, record, f"{field}_changed", before, relationship_state(record), data.reason)
        return public_fields(record)


@router.patch("/cases/{record_id}/patient")
async def link_case_patient(organization: Organization, record_id: UUID, data: LinkChange, session: Session):
    return await change_link(session, organization, Case, Patient, "patient_id", record_id, data)


@router.patch("/slides/{record_id}/specimen")
async def link_slide_specimen(organization: Organization, record_id: UUID, data: LinkChange, session: Session):
    return await change_link(session, organization, Slide, Specimen, "specimen_id", record_id, data)


@router.get("/{category}/{record_id}/external-identifiers")
async def get_identifiers(organization: Organization, category: IdentityCategory, record_id: UUID, session: Session):
    await find(session, MODELS[category], organization, record_id)
    field = getattr(ExternalIdentifier, category.removesuffix("s") + "_id")
    results = await session.scalars(
        select(ExternalIdentifier).where(ExternalIdentifier.organization == organization, field == record_id)
        .order_by(ExternalIdentifier.first_received_at, ExternalIdentifier.id)
    )
    return [public_fields(identifier) for identifier in results]


async def registered_identifier(session: AsyncSession, organization: str, data: IdentifierQuery):
    return await session.scalar(select(ExternalIdentifier).where(
        ExternalIdentifier.organization == organization, ExternalIdentifier.system == data.system,
        ExternalIdentifier.kind == data.kind, ExternalIdentifier.value == data.value,
    ))


@router.post("/{category}/external-identifiers/lookup")
async def lookup_identifier(organization: Organization, category: IdentityCategory, data: IdentifierQuery, session: Session):
    identifier = await registered_identifier(session, organization, data)
    record_id = getattr(identifier, category.removesuffix("s") + "_id", None)
    if record_id is None:
        raise HTTPException(404, "No matching external identifier is linked in this organization.")
    await find(session, MODELS[category], organization, record_id)
    return {"record_id": record_id, "identifier": public_fields(identifier)}


@router.post("/{category}/{record_id}/external-identifiers")
async def link_identifier(organization: Organization, category: IdentityCategory, record_id: UUID, data: IdentifierLink, session: Session):
    field = category.removesuffix("s") + "_id"
    async with write(session):
        record = await find(session, MODELS[category], organization, record_id, lock=True)
        require_version(record, data.version)
        existing = await registered_identifier(session, organization, data)
        if existing:
            if getattr(existing, field) != record_id:
                raise HTTPException(409, "This external identifier is linked to another record. Check the organization and identifier.")
            return {"record_version": record.version, "identifier": public_fields(existing)}

        identifier = ExternalIdentifier(
            organization=organization, system=data.system, kind=data.kind, value=data.value,
            source=SOURCE, linked_by=str(session.info["user"].id), **{field: record_id},
        )
        session.add(identifier)
        record.version += 1
        await session.flush()
        add_event(session, record, "external_identifier_linked", {}, {"identifier_id": str(identifier.id)}, data.reason)
        return {"record_version": record.version, "identifier": public_fields(identifier)}


@router.get("/{category}/{record_id}/history")
async def history(
    organization: Organization, category: Category, record_id: UUID, session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 50, offset: Annotated[int, Query(ge=0)] = 0,
):
    await find(session, MODELS[category], organization, record_id)
    events = await session.scalars(select(ClinicalEvent).where(
        ClinicalEvent.organization == organization, ClinicalEvent.record_type == MODELS[category].__tablename__,
        ClinicalEvent.record_id == record_id,
    ).order_by(ClinicalEvent.version.desc()).offset(offset).limit(limit))
    return [public_fields(event) for event in events]
