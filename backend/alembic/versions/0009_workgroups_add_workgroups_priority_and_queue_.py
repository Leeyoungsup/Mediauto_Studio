"""add workgroups, priority and queue subscriptions"""

from alembic import op
import sqlalchemy as sa


revision = '0009_workgroups'
down_revision = '0008_worklist_filters'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'workgroups',
        sa.Column('key', sa.String(length=48), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'key')
    )
    op.create_table(
        'queue_subscriptions',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('queue_key', sa.String(length=48), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'user_id', 'queue_key')
    )
    op.create_table(
        'workgroup_members',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('group_key', sa.String(length=48), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'group_key'], ['workgroups.organization', 'workgroups.key']),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id']),
        sa.PrimaryKeyConstraint('organization', 'group_key', 'user_id')
    )
    op.add_column('cases', sa.Column('group_key', sa.String(length=48), nullable=True))
    op.add_column('cases', sa.Column('priority', sa.String(length=16), nullable=True))
    op.add_column('cases', sa.Column('priority_source', sa.String(length=24), nullable=True))
    op.create_index('ix_cases_workgroup', 'cases', ['organization', 'group_key'], unique=False)
    op.create_foreign_key('fk_cases_workgroup', 'cases', 'workgroups', ['organization', 'group_key'], ['organization', 'key'])
    op.create_check_constraint('case_priority', 'cases', "priority IN ('routine', 'urgent', 'frozen')")
    op.create_check_constraint('case_priority_source', 'cases', '(priority IS NULL AND priority_source IS NULL) OR (priority IS NOT NULL AND priority_source IS NOT NULL)')


def downgrade() -> None:
    op.drop_constraint('case_priority_source', 'cases', type_='check')
    op.drop_constraint('case_priority', 'cases', type_='check')
    op.drop_constraint('fk_cases_workgroup', 'cases', type_='foreignkey')
    op.drop_index('ix_cases_workgroup', table_name='cases')
    op.drop_column('cases', 'priority_source')
    op.drop_column('cases', 'priority')
    op.drop_column('cases', 'group_key')
    op.drop_table('workgroup_members')
    op.drop_table('queue_subscriptions')
    op.drop_table('workgroups')
