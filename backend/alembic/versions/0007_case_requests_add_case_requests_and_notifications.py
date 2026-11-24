"""add case requests and notifications"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0007_case_requests'
down_revision = '0006_worklist_views'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'case_requests',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=True),
        sa.Column('requested_by', sa.Uuid(), nullable=False),
        sa.Column('assigned_to', sa.Uuid(), nullable=True),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('question', sa.String(length=2000), nullable=False),
        sa.Column('result_note', sa.String(length=2000), nullable=True),
        sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("kind <> 'ai' OR scan_id IS NOT NULL", name='case_request_ai_scan'),
        sa.CheckConstraint("kind IN ('ai', 'consult')", name='case_request_kind'),
        sa.CheckConstraint("status IN ('open','assigned','in_progress','completed','failed','cancelled')", name='case_request_status'),
        sa.ForeignKeyConstraint(['organization', 'assigned_to'], ['auth_users.organization', 'auth_users.id']),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id']),
        sa.ForeignKeyConstraint(['organization', 'requested_by'], ['auth_users.organization', 'auth_users.id']),
        sa.ForeignKeyConstraint(['scan_id'], ['slide_scans.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'requested_by', 'request_key')
    )
    op.create_index('ix_case_requests_case', 'case_requests', ['organization', 'case_id', 'created_at'], unique=False)
    op.create_table(
        'request_notifications',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('event_version', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['organization', 'recipient_id'], ['auth_users.organization', 'auth_users.id']),
        sa.ForeignKeyConstraint(['organization', 'request_id'], ['case_requests.organization', 'case_requests.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('request_id', 'event_version', 'recipient_id')
    )
    op.create_index('ix_request_notifications_recipient', 'request_notifications', ['organization', 'recipient_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_request_notifications_recipient', table_name='request_notifications')
    op.drop_table('request_notifications')
    op.drop_index('ix_case_requests_case', table_name='case_requests')
    op.drop_table('case_requests')
