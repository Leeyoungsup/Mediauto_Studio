"""IHC result revisions"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0022_ihc_result_revisions'
down_revision = '0021_review_room'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('ihc_result_revisions',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('source_id', sa.String(length=64), nullable=False),
        sa.Column('action', sa.String(length=16), nullable=False),
        sa.Column('threshold', sa.Float(), nullable=False),
        sa.Column('overrides', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=False),
        sa.Column('request_key', sa.Uuid(), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("action IN ('edit', 'restore')", name='ihc_result_action'),
        sa.CheckConstraint('threshold BETWEEN 0 AND 1', name='ihc_result_threshold'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'scan_id', 'source_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'case_id', 'scan_id', 'source_id', 'version')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM ihc_result_revisions)")):
        raise RuntimeError("Archive IHC result revisions before downgrading.")
    op.drop_table('ihc_result_revisions')
