"""add case reporting and LIS transmission"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0016_case_reporting'
down_revision = '0015_case_notifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('report_templates',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('template_key', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('sections', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'template_key', 'version'),
    )
    op.create_table('case_reports',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id'),
        sa.UniqueConstraint('organization', 'id'),
    )
    op.create_table('report_revisions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('report_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('replaces_version', sa.Integer(), nullable=True),
        sa.Column('correction_reason', sa.String(length=240), nullable=True),
        sa.Column('author', sa.String(length=80), nullable=False),
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status IN ('draft','in_review','approved')", name='report_revision_status'),
        sa.ForeignKeyConstraint(['organization', 'report_id'], ['case_reports.organization', 'case_reports.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'report_id', 'id'),
        sa.UniqueConstraint('organization', 'report_id', 'version'),
    )
    op.create_table('report_transmissions',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('report_id', sa.Uuid(), nullable=False),
        sa.Column('revision_id', sa.Uuid(), nullable=False),
        sa.Column('report_version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('digest', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('due_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('error', sa.String(length=32), nullable=True),
        sa.Column('ack_id', sa.String(length=128), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("status IN ('queued','sending','retry_wait','acknowledged','failed')", name='report_transmission_status'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'report_id', 'revision_id'], ['report_revisions.organization', 'report_revisions.report_id', 'report_revisions.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'report_id', 'revision_id'),
    )
    op.create_index('ix_report_transmission_due', 'report_transmissions', ['status', 'due_at'], unique=False)
    op.add_column('integration_connections', sa.Column('report_delivery_enabled', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('integration_connections', 'report_delivery_enabled')
    op.drop_index('ix_report_transmission_due', table_name='report_transmissions')
    op.drop_table('report_transmissions')
    op.drop_table('report_revisions')
    op.drop_table('case_reports')
    op.drop_table('report_templates')
