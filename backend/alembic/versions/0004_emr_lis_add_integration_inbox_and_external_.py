"""add integration inbox and external snapshots"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0004_emr_lis'
down_revision = '0003_auth_worklist'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('integration_connections',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('channel', sa.String(length=8), nullable=False),
        sa.Column('mode', sa.String(length=16), nullable=False),
        sa.Column('scenario', sa.String(length=16), nullable=False),
        sa.Column('state', sa.String(length=24), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('organization', 'channel'),
    )
    op.create_table('integration_messages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('channel', sa.String(length=8), nullable=False),
        sa.Column('message_id', sa.String(length=128), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('digest', sa.String(length=64), nullable=False),
        sa.Column('state', sa.String(length=24), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('delivery_conflicts', sa.Integer(), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', sa.String(length=48), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'channel', 'message_id'),
    )
    op.create_index('ix_integration_due', 'integration_messages', ['state', 'next_attempt_at'], unique=False)
    op.create_index('ix_integration_inbox', 'integration_messages', ['organization', 'received_at'], unique=False)
    op.create_table('integration_snapshots',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('channel', sa.String(length=8), nullable=False),
        sa.Column('resource', sa.String(length=12), nullable=False),
        sa.Column('external_id', sa.String(length=160), nullable=False),
        sa.Column('revision', sa.BigInteger(), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('digest', sa.String(length=64), nullable=False),
        sa.Column('first_received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('organization', 'channel', 'resource', 'external_id'),
    )


def downgrade() -> None:
    op.drop_table('integration_snapshots')
    op.drop_index('ix_integration_inbox', table_name='integration_messages')
    op.drop_index('ix_integration_due', table_name='integration_messages')
    op.drop_table('integration_messages')
    op.drop_table('integration_connections')
