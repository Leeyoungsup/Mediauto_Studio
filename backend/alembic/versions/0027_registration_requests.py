"""Account registration requests."""

from alembic import op
import sqlalchemy as sa


revision = "0027_registration_requests"
down_revision = "0026_related_case_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "registration_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization", sa.String(64), nullable=False),
        sa.Column("username", sa.String(80), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.String(120)),
        sa.Column("state", sa.String(16), server_default="pending", nullable=False),
        sa.Column("role", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewer_id", sa.Uuid()),
        sa.ForeignKeyConstraint(["organization", "reviewer_id"], ["auth_users.organization", "auth_users.id"]),
        sa.CheckConstraint("state IN ('pending', 'approved', 'rejected')", name="registration_request_state"),
        sa.CheckConstraint(
            "(state = 'pending' AND password_hash IS NOT NULL AND reviewer_id IS NULL "
            "AND reviewed_at IS NULL AND role IS NULL) OR "
            "(state = 'approved' AND password_hash IS NULL AND reviewer_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND role IN ('doctor', 'labeler', 'viewer') AND role IS NOT NULL) OR "
            "(state = 'rejected' AND password_hash IS NULL AND reviewer_id IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND role IS NULL)", name="registration_request_review",
        ),
    )
    op.create_index("ix_registration_pending_username", "registration_requests", ["organization", "username"],
                    unique=True, postgresql_where=sa.text("state = 'pending'"))


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM registration_requests)")):
        raise RuntimeError("Keep the registration audit table or archive its records before downgrading.")
    op.drop_index("ix_registration_pending_username", table_name="registration_requests")
    op.drop_table("registration_requests")
