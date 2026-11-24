"""Add case activity and stable audit scope for new clinical events."""

from alembic import op
import sqlalchemy as sa

revision = "0014_case_logs"
down_revision = "0013_case_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clinical_events", sa.Column("case_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_clinical_event_case", "clinical_events", "cases",
                          ["organization", "case_id"], ["organization", "id"])
    op.create_index("ix_clinical_event_case_time", "clinical_events", ["organization", "case_id", "occurred_at", "id"])
    op.create_table(
        "case_activity",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization", sa.String(length=64), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("entity", sa.String(length=24), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("result", sa.String(length=8), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("result IN ('success', 'failed', 'denied')", name="case_activity_result"),
        sa.ForeignKeyConstraint(["organization", "case_id"], ["cases.organization", "cases.id"]),
        sa.ForeignKeyConstraint(["organization", "actor_id"], ["auth_users.organization", "auth_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization", "actor_id", "action", "entity", "target_id", "attempt_id", name="uq_case_activity_attempt"),
    )
    op.create_index("ix_case_activity_time", "case_activity", ["organization", "case_id", "occurred_at", "id"])


def downgrade() -> None:
    op.drop_table("case_activity")
    op.drop_index("ix_clinical_event_case_time", table_name="clinical_events")
    op.drop_constraint("fk_clinical_event_case", "clinical_events", type_="foreignkey")
    op.drop_column("clinical_events", "case_id")
