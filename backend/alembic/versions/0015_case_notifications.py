"""add case notes and notification deliveries"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0015_case_notifications'
down_revision = '0014_case_logs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('notification_preferences',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('rules', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('push_endpoint', sa.String(length=1000), nullable=True),
        sa.Column('push_keys', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'user_id'),
        sa.UniqueConstraint('push_endpoint'),
    )
    op.create_table('case_notes',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('parent_id', sa.Uuid(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('mentions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'parent_id'], ['case_notes.organization', 'case_notes.case_id', 'case_notes.id'], ),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'case_id', 'id'),
    )
    op.create_index('ix_case_notes_thread', 'case_notes', ['organization', 'case_id', 'parent_id', 'created_at', 'id'], unique=False)
    op.create_table('notification_deliveries',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('request_id', sa.Uuid(), nullable=True),
        sa.Column('event_key', sa.String(length=150), nullable=False),
        sa.Column('event', sa.String(length=24), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('channel', sa.String(length=8), nullable=False),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('error', sa.String(length=40), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("channel IN ('in_app','email','push')", name='notification_delivery_channel'),
        sa.CheckConstraint("status IN ('queued','sending','retry_wait','delivered','blocked','failed')", name='notification_delivery_state'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'recipient_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.ForeignKeyConstraint(['organization', 'request_id'], ['case_requests.organization', 'case_requests.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'recipient_id', 'event_key', 'channel'),
    )
    op.create_index('ix_notification_delivery_due', 'notification_deliveries', ['status', 'next_attempt_at'], unique=False)
    op.create_index('ix_notification_delivery_recipient', 'notification_deliveries', ['organization', 'recipient_id', 'created_at'], unique=False)
    op.add_column('auth_users', sa.Column('notification_email', sa.String(length=254), nullable=True))


def downgrade() -> None:
    op.drop_column('auth_users', 'notification_email')
    op.drop_index('ix_notification_delivery_recipient', table_name='notification_deliveries')
    op.drop_index('ix_notification_delivery_due', table_name='notification_deliveries')
    op.drop_table('notification_deliveries')
    op.drop_index('ix_case_notes_thread', table_name='case_notes')
    op.drop_table('case_notes')
    op.drop_table('notification_preferences')
