from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ApplicationSetting(Base):
    __tablename__ = "application_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ClinicalRecord:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)


class Patient(ClinicalRecord, Base):
    __tablename__ = "patients"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "local_reference"),
        CheckConstraint("display_name IS NOT NULL OR local_reference IS NOT NULL", name="patient_minimum_identity"),
    )

    display_name: Mapped[str | None] = mapped_column(String(120))
    local_reference: Mapped[str | None] = mapped_column(String(80))
    birth_date: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(24), nullable=False)


class Case(ClinicalRecord, Base):
    __tablename__ = "cases"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "case_number"),
        ForeignKeyConstraint(("organization", "patient_id"), ("patients.organization", "patients.id")),
        Index("ix_cases_patient", "organization", "patient_id"),
    )

    case_number: Mapped[str] = mapped_column(String(80), nullable=False)
    patient_id: Mapped[UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class Specimen(ClinicalRecord, Base):
    __tablename__ = "specimens"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "case_id", "specimen_number"),
        ForeignKeyConstraint(("organization", "case_id"), ("cases.organization", "cases.id")),
    )

    specimen_number: Mapped[str] = mapped_column(String(80), nullable=False)
    case_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    description: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class Slide(ClinicalRecord, Base):
    __tablename__ = "slides"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "specimen_id", "slide_number"),
        ForeignKeyConstraint(("organization", "specimen_id"), ("specimens.organization", "specimens.id")),
    )

    slide_number: Mapped[str] = mapped_column(String(80), nullable=False)
    specimen_id: Mapped[UUID | None] = mapped_column(Uuid)
    stain: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(24), nullable=False)


class SlideScan(ClinicalRecord, Base):
    __tablename__ = "slide_scans"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "slide_id"), ("slides.organization", "slides.id")),
        Index("ix_slide_scans_slide", "organization", "slide_id"),
    )

    slide_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    format: Mapped[str] = mapped_column(String(12), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    modified_ns: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class ExternalIdentifier(Base):
    __tablename__ = "external_identifiers"
    __table_args__ = (
        UniqueConstraint("organization", "system", "kind", "value"),
        CheckConstraint(
            "num_nonnulls(patient_id, case_id, specimen_id, slide_id) = 1",
            name="external_identifier_one_owner",
        ),
        ForeignKeyConstraint(("organization", "patient_id"), ("patients.organization", "patients.id")),
        ForeignKeyConstraint(("organization", "case_id"), ("cases.organization", "cases.id")),
        ForeignKeyConstraint(("organization", "specimen_id"), ("specimens.organization", "specimens.id")),
        ForeignKeyConstraint(("organization", "slide_id"), ("slides.organization", "slides.id")),
        Index("ix_external_identifiers_patient", "organization", "patient_id"),
        Index("ix_external_identifiers_case", "organization", "case_id"),
        Index("ix_external_identifiers_specimen", "organization", "specimen_id"),
        Index("ix_external_identifiers_slide", "organization", "slide_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    system: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(String(160))
    patient_id: Mapped[UUID | None] = mapped_column(Uuid)
    case_id: Mapped[UUID | None] = mapped_column(Uuid)
    specimen_id: Mapped[UUID | None] = mapped_column(Uuid)
    slide_id: Mapped[UUID | None] = mapped_column(Uuid)
    source: Mapped[str] = mapped_column(String(24))
    linked_by: Mapped[str] = mapped_column(String(80))
    first_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connection_state: Mapped[str] = mapped_column(String(24), server_default="linked")


class ClinicalEvent(Base):
    __tablename__ = "clinical_events"
    __table_args__ = (UniqueConstraint("organization", "record_type", "record_id", "version"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    record_type: Mapped[str] = mapped_column(String(24))
    record_id: Mapped[UUID] = mapped_column(Uuid)
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(40))
    actor: Mapped[str] = mapped_column(String(80))
    source: Mapped[str] = mapped_column(String(24))
    before: Mapped[dict] = mapped_column(JSONB)
    after: Mapped[dict] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(String(240))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    transaction_id: Mapped[UUID] = mapped_column(Uuid)


class RegistrationRequest(Base):
    __tablename__ = "clinical_registration_requests"

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation: Mapped[str] = mapped_column(String(24), primary_key=True)
    request_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    record_id: Mapped[UUID] = mapped_column(Uuid)
