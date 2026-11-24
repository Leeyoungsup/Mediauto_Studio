"""Store verified PDF and specimen image attachments."""

from alembic import op
import sqlalchemy as sa

revision = "0013_case_attachments"
down_revision = "0012_patient_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_specimen_case_id", "specimens", ["organization", "case_id", "id"])
    op.create_table(
        "case_attachments",
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("specimen_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("filename", sa.String(length=160), nullable=False),
        sa.Column("pages", sa.Integer(), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("request_key", sa.String(length=128), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.CheckConstraint(
            "(kind = 'pdf' AND specimen_id IS NULL AND pages BETWEEN 1 AND 50 AND pages IS NOT NULL) OR "
            "(kind = 'gross' AND specimen_id IS NOT NULL AND pages IS NULL)",
            name="case_attachment_scope",
        ),
        sa.ForeignKeyConstraint(["organization", "case_id"], ["cases.organization", "cases.id"]),
        sa.ForeignKeyConstraint(["organization", "case_id", "specimen_id"],
                                ["specimens.organization", "specimens.case_id", "specimens.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization", "case_id", "created_by", "request_key"),
    )
    op.create_index("ix_case_attachments_case", "case_attachments", ["organization", "case_id", "kind", "created_at"])


def downgrade() -> None:
    op.drop_table("case_attachments")
    op.drop_constraint("uq_specimen_case_id", "specimens", type_="unique")
