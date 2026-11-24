"""Store viewer defaults per organization and user."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011_viewer_preferences"
down_revision = "0010_case_editor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "viewer_preferences",
        sa.Column("organization", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("settings", JSONB(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization", "user_id"], ["auth_users.organization", "auth_users.id"], ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("organization", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("viewer_preferences")
