from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, ForeignKeyConstraint, Index, Integer, LargeBinary, String, Text, UniqueConstraint, Uuid, func
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


class AuthUser(Base):
    __tablename__ = "auth_users"
    __table_args__ = (
        UniqueConstraint("organization", "username"),
        UniqueConstraint("organization", "id"),
        CheckConstraint("role IN ('admin', 'doctor', 'labeler', 'viewer')", name="auth_user_role"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    username: Mapped[str] = mapped_column(String(80))
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(16))
    password_hash: Mapped[str] = mapped_column(String(120))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("auth_users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


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
    sex: Mapped[str | None] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(24), nullable=False)


class Workgroup(ClinicalRecord, Base):
    __tablename__ = "workgroups"
    __table_args__ = (UniqueConstraint("organization", "key"),)

    key: Mapped[str] = mapped_column(String(48))
    name: Mapped[str] = mapped_column(String(80))


class WorkgroupMember(Base):
    __tablename__ = "workgroup_members"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "group_key"), ("workgroups.organization", "workgroups.key")),
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id")),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_key: Mapped[str] = mapped_column(String(48), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)


class QueueSubscription(Base):
    __tablename__ = "queue_subscriptions"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id"), ondelete="CASCADE"),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    queue_key: Mapped[str] = mapped_column(String(48), primary_key=True)


class Case(ClinicalRecord, Base):
    __tablename__ = "cases"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "case_number"),
        ForeignKeyConstraint(("organization", "patient_id"), ("patients.organization", "patients.id")),
        ForeignKeyConstraint(("organization", "assigned_to"), ("auth_users.organization", "auth_users.id"), name="fk_cases_assignee"),
        Index("ix_cases_patient", "organization", "patient_id"),
        Index("ix_cases_assignee", "organization", "assigned_to"),
        Index("ix_cases_workgroup", "organization", "group_key"),
        ForeignKeyConstraint(("organization", "group_key"), ("workgroups.organization", "workgroups.key"), name="fk_cases_workgroup"),
        CheckConstraint("priority IN ('routine', 'urgent', 'frozen')", name="case_priority"),
        CheckConstraint("(priority IS NULL AND priority_source IS NULL) OR "
                        "(priority IS NOT NULL AND priority_source IS NOT NULL)", name="case_priority_source"),
    )

    group_key: Mapped[str | None] = mapped_column(String(48))
    priority: Mapped[str | None] = mapped_column(String(16))
    priority_source: Mapped[str | None] = mapped_column(String(24))
    accessioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    case_number: Mapped[str] = mapped_column(String(80), nullable=False)
    patient_id: Mapped[UUID | None] = mapped_column(Uuid)
    assigned_to: Mapped[UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class Specimen(ClinicalRecord, Base):
    __tablename__ = "specimens"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "case_id", "specimen_number"),
        ForeignKeyConstraint(("organization", "case_id"), ("cases.organization", "cases.id")),
    )

    collection_date: Mapped[date | None] = mapped_column(Date)
    specimen_number: Mapped[str] = mapped_column(String(80), nullable=False)
    case_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    description: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class SpecimenBlock(ClinicalRecord, Base):
    __tablename__ = "specimen_blocks"
    __table_args__ = (
        UniqueConstraint("organization", "specimen_id", "id"),
        UniqueConstraint("organization", "specimen_id", "block_number"),
        ForeignKeyConstraint(("organization", "specimen_id"), ("specimens.organization", "specimens.id")),
    )

    specimen_id: Mapped[UUID] = mapped_column(Uuid)
    block_number: Mapped[str] = mapped_column(String(80))


class Slide(ClinicalRecord, Base):
    __tablename__ = "slides"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "specimen_id", "slide_number"),
        UniqueConstraint("organization", "barcode", name="uq_slide_barcode_org"),
        ForeignKeyConstraint(("organization", "specimen_id", "block_id"),
            ("specimen_blocks.organization", "specimen_blocks.specimen_id", "specimen_blocks.id"), name="fk_slide_specimen_block"),
        CheckConstraint("block_id IS NULL OR specimen_id IS NOT NULL", name="slide_block_requires_specimen"),
        ForeignKeyConstraint(("organization", "specimen_id"), ("specimens.organization", "specimens.id")),
    )

    block_id: Mapped[UUID | None] = mapped_column(Uuid)
    barcode: Mapped[str | None] = mapped_column(String(120))
    label_text: Mapped[str | None] = mapped_column(String(500))
    slide_number: Mapped[str] = mapped_column(String(80), nullable=False)
    specimen_id: Mapped[UUID | None] = mapped_column(Uuid)
    stain: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(24), nullable=False)


class SlideScan(ClinicalRecord, Base):
    __tablename__ = "slide_scans"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "slide_id"), ("slides.organization", "slides.id")),
        Index("ix_slide_scans_slide", "organization", "slide_id"),
        UniqueConstraint("organization", "id", name="uq_scan_id_org"),
        UniqueConstraint("replaces_id", name="uq_scan_replacement"),
        ForeignKeyConstraint(("organization", "replaces_id"), ("slide_scans.organization", "slide_scans.id"),
                             name="fk_scan_replaces"),
        CheckConstraint("qc_status IN ('unassessed','passed','hold','rescan_required','replaced')", name="scan_qc_status"),
    )

    slide_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    scanner: Mapped[str | None] = mapped_column(String(120))
    qc_status: Mapped[str] = mapped_column(String(24), server_default="unassessed")
    replaces_id: Mapped[UUID | None] = mapped_column(Uuid)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    format: Mapped[str] = mapped_column(String(12), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    modified_ns: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), server_default="registered")


class ScanLabel(Base):
    __tablename__ = "scan_labels"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "scan_id"), ("slide_scans.organization", "slide_scans.id")),
        UniqueConstraint("organization", "scan_id", "version"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    scan_id: Mapped[UUID] = mapped_column(Uuid)
    version: Mapped[int] = mapped_column(Integer)
    jpeg: Mapped[bytes] = mapped_column(LargeBinary)


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


class IntegrationConnection(Base):
    __tablename__ = "integration_connections"

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    channel: Mapped[str] = mapped_column(String(8), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16))
    scenario: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(24))
    version: Mapped[int] = mapped_column(Integer, default=1)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IntegrationMessage(Base):
    __tablename__ = "integration_messages"
    __table_args__ = (
        UniqueConstraint("organization", "channel", "message_id"),
        Index("ix_integration_due", "state", "next_attempt_at"),
        Index("ix_integration_inbox", "organization", "received_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    channel: Mapped[str] = mapped_column(String(8))
    message_id: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSONB)
    digest: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(24))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    delivery_conflicts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(48))


class PatientHistoryRecord(ClinicalRecord, Base):
    __tablename__ = "patient_history_records"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "patient_id"), ("patients.organization", "patients.id")),
        ForeignKeyConstraint(("organization", "case_id"), ("cases.organization", "cases.id")),
        UniqueConstraint("organization", "created_by", "request_key"),
        CheckConstraint("kind IN ('diagnostic_report', 'encounter_note')", name="patient_history_kind"),
        Index("ix_patient_history_date", "organization", "patient_id", "occurred_on", "id"),
    )

    patient_id: Mapped[UUID] = mapped_column(Uuid)
    case_id: Mapped[UUID] = mapped_column(Uuid)
    request_key: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    occurred_on: Mapped[date] = mapped_column(Date)


class ExternalSnapshot(Base):
    __tablename__ = "integration_snapshots"

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    channel: Mapped[str] = mapped_column(String(8), primary_key=True)
    resource: Mapped[str] = mapped_column(String(12), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    revision: Mapped[int] = mapped_column(BigInteger)
    payload: Mapped[dict] = mapped_column(JSONB)
    digest: Mapped[str] = mapped_column(String(64))
    first_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


Index("ix_history_external_patient", ExternalSnapshot.organization,
      ExternalSnapshot.payload["patient_external_id"].astext,
      postgresql_where=ExternalSnapshot.resource == "history")


class ViewerPosition(Base):
    __tablename__ = "viewer_positions"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id"), ondelete="CASCADE"),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    scan_key: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    zoom: Mapped[float] = mapped_column(Float)
    version: Mapped[int] = mapped_column(Integer)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ViewerAnnotation(Base):
    __tablename__ = "viewer_annotations"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "author_id"), ("auth_users.organization", "auth_users.id")),
        CheckConstraint("kind IN ('rectangle', 'distance')", name="viewer_annotation_kind"),
        Index("ix_viewer_annotations_scan", "organization", "scan_key", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    organization: Mapped[str] = mapped_column(String(64))
    scan_key: Mapped[UUID] = mapped_column(Uuid)
    author_id: Mapped[UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(16))
    points: Mapped[list] = mapped_column(JSONB)
    label: Mapped[str] = mapped_column(String(160))
    version: Mapped[int] = mapped_column(Integer)
    length: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(4))
    mpp_x: Mapped[float | None] = mapped_column(Float)
    mpp_y: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorklistView(Base):
    __tablename__ = "worklist_views"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "owner_id"), ("auth_users.organization", "auth_users.id")),
        CheckConstraint("visibility IN ('private', 'shared')", name="worklist_view_visibility"),
        Index("ix_worklist_views_org_visibility", "organization", "visibility"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    owner_id: Mapped[UUID] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(80))
    visibility: Mapped[str] = mapped_column(String(12))
    configuration: Mapped[dict] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorklistPreference(Base):
    __tablename__ = "worklist_preferences"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id"), ondelete="CASCADE"),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    sort_order: Mapped[list | None] = mapped_column(JSONB)
    default_view_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("worklist_views.id", ondelete="SET NULL"))
    columns: Mapped[list | None] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer)


class ViewerPreference(Base):
    __tablename__ = "viewer_preferences"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id"), ondelete="CASCADE"),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    settings: Mapped[dict] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer)


class CaseRequest(ClinicalRecord, Base):
    __tablename__ = "case_requests"
    __table_args__ = (
        UniqueConstraint("organization", "id"),
        UniqueConstraint("organization", "requested_by", "request_key"),
        ForeignKeyConstraint(("organization", "case_id"), ("cases.organization", "cases.id")),
        ForeignKeyConstraint(("scan_id",), ("slide_scans.id",)),
        ForeignKeyConstraint(("organization", "requested_by"), ("auth_users.organization", "auth_users.id")),
        ForeignKeyConstraint(("organization", "assigned_to"), ("auth_users.organization", "auth_users.id")),
        CheckConstraint("kind IN ('ai', 'consult')", name="case_request_kind"),
        CheckConstraint("status IN ('open','assigned','in_progress','completed','failed','cancelled')",
                        name="case_request_status"),
        CheckConstraint("kind <> 'ai' OR scan_id IS NOT NULL", name="case_request_ai_scan"),
        Index("ix_case_requests_case", "organization", "case_id", "created_at"),
    )

    case_id: Mapped[UUID] = mapped_column(Uuid)
    scan_id: Mapped[UUID | None] = mapped_column(Uuid)
    requested_by: Mapped[UUID] = mapped_column(Uuid)
    assigned_to: Mapped[UUID | None] = mapped_column(Uuid)
    request_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    question: Mapped[str] = mapped_column(String(2000))
    result_note: Mapped[str | None] = mapped_column(String(2000))
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RequestNotification(Base):
    __tablename__ = "request_notifications"
    __table_args__ = (
        UniqueConstraint("request_id", "event_version", "recipient_id"),
        ForeignKeyConstraint(("organization", "request_id"), ("case_requests.organization", "case_requests.id")),
        ForeignKeyConstraint(("organization", "recipient_id"), ("auth_users.organization", "auth_users.id")),
        Index("ix_request_notifications_recipient", "organization", "recipient_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    organization: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[UUID] = mapped_column(Uuid)
    recipient_id: Mapped[UUID] = mapped_column(Uuid)
    event_version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorklistOpen(Base):
    __tablename__ = "worklist_opens"
    __table_args__ = (
        ForeignKeyConstraint(("organization", "user_id"), ("auth_users.organization", "auth_users.id"), ondelete="CASCADE"),
    )

    organization: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    record_key: Mapped[str] = mapped_column(String(90), primary_key=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
