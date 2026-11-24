"""case collections and tumor board"""

from alembic import op
import sqlalchemy as sa


revision = '0020_case_collections'
down_revision = '0019_analysis_execution'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('case_collections',
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('parent_id', sa.Uuid(), nullable=True),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('meeting_date', sa.Date(), nullable=True),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("(kind = 'meeting' AND parent_id IS NOT NULL AND meeting_date IS NOT NULL) OR (kind <> 'meeting' AND parent_id IS NULL AND meeting_date IS NULL)", name='case_collection_parent'),
        sa.CheckConstraint("kind IN ('personal','shared','board','meeting')", name='case_collection_kind'),
        sa.ForeignKeyConstraint(['organization', 'owner_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.ForeignKeyConstraint(['organization', 'parent_id'], ['case_collections.organization', 'case_collections.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'id')
    )
    op.create_table('collection_entries',
        sa.Column('collection_id', sa.Uuid(), nullable=False),
        sa.Column('linked_case_id', sa.Uuid(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=2000), nullable=False),
        sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('presented_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('presented_by', sa.Uuid(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'collection_id'], ['case_collections.organization', 'case_collections.id'], ),
        sa.ForeignKeyConstraint(['organization', 'linked_case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'presented_by'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'collection_id', 'linked_case_id')
    )
    op.create_index('ix_collection_entries_order', 'collection_entries', ['organization', 'collection_id', 'position'], unique=False)
    op.create_table('collection_members',
        sa.Column('collection_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('role', sa.String(length=12), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("role IN ('viewer','editor')", name='collection_member_role'),
        sa.ForeignKeyConstraint(['organization', 'collection_id'], ['case_collections.organization', 'case_collections.id'], ),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'collection_id', 'user_id')
    )
    op.create_index('ix_collection_members_user', 'collection_members', ['organization', 'user_id'], unique=False)


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM case_collections)")):
        raise RuntimeError("Archive case collections and Board agendas before downgrading.")
    op.drop_index('ix_collection_members_user', table_name='collection_members')
    op.drop_table('collection_members')
    op.drop_index('ix_collection_entries_order', table_name='collection_entries')
    op.drop_table('collection_entries')
    op.drop_table('case_collections')
