"""Add append-only local patient history and index external records by patient."""

from alembic import op
import sqlalchemy as sa

revision = "0012_patient_history"
down_revision = "0011_viewer_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patient_history_records",
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("request_key", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.CheckConstraint("kind IN ('diagnostic_report', 'encounter_note')", name="patient_history_kind"),
        sa.ForeignKeyConstraint(["organization", "patient_id"], ["patients.organization", "patients.id"]),
        sa.ForeignKeyConstraint(["organization", "case_id"], ["cases.organization", "cases.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization", "created_by", "request_key"),
    )
    op.create_index("ix_patient_history_date", "patient_history_records", ["organization", "patient_id", "occurred_on", "id"])
    op.create_index(
        "ix_history_external_patient", "integration_snapshots",
        ["organization", sa.text("(payload ->> 'patient_external_id')")],
        postgresql_where=sa.text("resource = 'history'"),
    )


def downgrade() -> None:
    op.drop_index("ix_history_external_patient", table_name="integration_snapshots")
    op.drop_table("patient_history_records")
