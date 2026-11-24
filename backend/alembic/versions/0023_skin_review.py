"""skin review revisions"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0023_skin_review'
down_revision = '0022_ihc_result_revisions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('skin_review_revisions',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('source_id', sa.String(length=80), nullable=False),
        sa.Column('action', sa.String(length=24), nullable=False),
        sa.Column('state', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('change', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=False),
        sa.Column('request_key', sa.Uuid(), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("action IN ('window', 'remove_window', 'add', 'decide')", name='skin_review_action'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'scan_id', 'source_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'case_id', 'scan_id', 'source_id', 'version')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM skin_review_revisions)")):
        raise RuntimeError("Archive skin review revisions before downgrading.")
    op.drop_table('skin_review_revisions')
