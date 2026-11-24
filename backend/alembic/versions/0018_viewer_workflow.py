"""Expand viewer tool geometry and persist versioned manual lymph node counts."""

import sqlalchemy as sa
from alembic import op

revision = "0018_viewer_workflow"
down_revision = "0017_frozen_workflow"
branch_labels = None
depends_on = None

ORIGINAL_KINDS = "kind IN ('rectangle', 'distance')"
TOOL_KINDS = "kind IN ('rectangle', 'distance', 'ellipse', 'point', 'arrow', 'polygon', 'brush', 'count', 'bookmark')"


def upgrade():
    op.drop_constraint("viewer_annotation_kind", "viewer_annotations", type_="check")
    op.create_check_constraint("viewer_annotation_kind", "viewer_annotations", TOOL_KINDS)
    op.add_column("viewer_annotations", sa.Column("zoom", sa.Float(), nullable=True))
    op.create_table(
        "lymph_node_counts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("specimen_id", sa.Uuid(), nullable=False),
        sa.Column("scan_id", sa.Uuid(), nullable=False),
        sa.Column("positive", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(240)),
        sa.ForeignKeyConstraint(("organization", "specimen_id"), ("specimens.organization", "specimens.id")),
        sa.ForeignKeyConstraint(("organization", "scan_id"), ("slide_scans.organization", "slide_scans.id")),
        sa.UniqueConstraint("organization", "specimen_id", "version"),
        sa.CheckConstraint("positive >= 0 AND total >= positive", name="lymph_node_count_values"),
    )


def downgrade():
    connection = op.get_bind()
    incompatible = connection.scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM lymph_node_counts) OR EXISTS (SELECT 1 FROM viewer_annotations "
        "WHERE NOT (" + ORIGINAL_KINDS + ") OR (kind = 'distance' AND jsonb_array_length(points) > 2))"
    ))
    if incompatible:
        raise RuntimeError("Archive extended viewer records and report references before downgrading this database.")
    op.drop_table("lymph_node_counts")
    op.drop_column("viewer_annotations", "zoom")
    op.drop_constraint("viewer_annotation_kind", "viewer_annotations", type_="check")
    op.create_check_constraint("viewer_annotation_kind", "viewer_annotations", ORIGINAL_KINDS)
