"""collaborative review room"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0021_review_room'
down_revision = '0020_case_collections'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('review_rooms',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('driver_id', sa.Uuid(), nullable=False),
        sa.Column('drive_epoch', sa.Integer(), server_default='1', nullable=False),
        sa.Column('frame_seq', sa.Integer(), server_default='0', nullable=False),
        sa.Column('frame', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'driver_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.ForeignKeyConstraint(['organization', 'owner_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id')
    )
    op.create_index('ix_one_active_review_room', 'review_rooms', ['organization', 'case_id'], unique=True, postgresql_where=sa.text('closed_at IS NULL'))
    op.create_table('review_participants',
        sa.Column('room_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('client_id', sa.Uuid(), nullable=True),
        sa.Column('follow', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'room_id'], ['review_rooms.organization', 'review_rooms.id'], ),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'room_id', 'user_id')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM review_rooms)")):
        raise RuntimeError("Archive collaborative review sessions before downgrading.")
    op.drop_table('review_participants')
    op.drop_index('ix_one_active_review_room', table_name='review_rooms', postgresql_where=sa.text('closed_at IS NULL'))
    op.drop_table('review_rooms')
