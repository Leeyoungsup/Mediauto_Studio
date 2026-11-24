"""analysis jobs rules and ihc reviews"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0019_analysis_execution'
down_revision = '0018_viewer_workflow'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('analysis_rules',
        sa.Column('model_key', sa.String(length=40), nullable=False),
        sa.Column('marker', sa.String(length=16), nullable=False),
        sa.Column('active', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'model_key', 'marker')
    )
    op.create_table('analysis_runs',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('model_key', sa.String(length=40), nullable=False),
        sa.Column('model_version', sa.String(length=32), nullable=False),
        sa.Column('marker', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('trigger_key', sa.String(length=128), nullable=True),
        sa.Column('source', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error', sa.String(length=40), nullable=True),
        sa.Column('pinned_snapshot', sa.String(length=64), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("status IN ('queued','running','completed','failed','cancelled')", name='analysis_run_status'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'request_id'], ['case_requests.organization', 'case_requests.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'trigger_key'),
        sa.UniqueConstraint('request_id', 'attempt'),
        sa.UniqueConstraint('request_id', 'request_key')
    )
    op.create_index('ix_analysis_runs_scan_model', 'analysis_runs', ['scan_id', 'model_key'], unique=False)
    op.create_index('ix_analysis_runs_worker', 'analysis_runs', ['status', 'created_at'], unique=False)
    op.create_table('ihc_reviews',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('specimen_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('marker', sa.String(length=16), nullable=False),
        sa.Column('interpretation', sa.String(length=20), nullable=False),
        sa.Column('block_id', sa.Uuid(), nullable=False),
        sa.Column('block_number', sa.String(length=80), nullable=False),
        sa.Column('run_id', sa.Uuid(), nullable=True),
        sa.Column('rationale', sa.String(length=240), nullable=False),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("interpretation IN ('positive','negative','indeterminate','uninterpretable')", name='ihc_review_interpretation'),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'specimen_id'], ['specimens.organization', 'specimens.case_id', 'specimens.id'], ),
        sa.ForeignKeyConstraint(['organization', 'run_id'], ['analysis_runs.organization', 'analysis_runs.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.ForeignKeyConstraint(['organization', 'specimen_id', 'block_id'], ['specimen_blocks.organization', 'specimen_blocks.specimen_id', 'specimen_blocks.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'specimen_id', 'marker', 'version')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM analysis_runs) OR EXISTS (SELECT 1 FROM ihc_reviews) OR EXISTS (SELECT 1 FROM analysis_rules)"
    )):
        raise RuntimeError("Archive analysis runs, IHC reviews and report references before downgrading.")
    op.drop_table('ihc_reviews')
    op.drop_index('ix_analysis_runs_worker', table_name='analysis_runs')
    op.drop_index('ix_analysis_runs_scan_model', table_name='analysis_runs')
    op.drop_table('analysis_runs')
    op.drop_table('analysis_rules')
