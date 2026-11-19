"""Create application settings and seed the unconfigured EMR state."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001_application_settings"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", JSONB, nullable=False),
    )
    op.execute(
        "INSERT INTO application_settings (key, value) "
        "VALUES ('emr', '{\"state\": \"unconfigured\"}'::jsonb)"
    )


def downgrade() -> None:
    op.drop_table("application_settings")
