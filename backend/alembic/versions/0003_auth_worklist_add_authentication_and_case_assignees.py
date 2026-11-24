"""add authentication and case assignees"""

from alembic import op
import sqlalchemy as sa


revision = '0003_auth_worklist'
down_revision = '0002_clinical_records'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'auth_users',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('username', sa.String(length=80), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('password_hash', sa.String(length=120), nullable=False),
        sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('failed_attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin', 'doctor', 'labeler', 'viewer')", name='auth_user_role'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'username'),
    )
    op.create_table(
        'auth_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_auth_sessions_expires_at'), 'auth_sessions', ['expires_at'], unique=False)
    op.add_column('cases', sa.Column('assigned_to', sa.Uuid(), nullable=True))
    op.create_index('ix_cases_assignee', 'cases', ['organization', 'assigned_to'], unique=False)
    op.create_foreign_key('fk_cases_assignee', 'cases', 'auth_users', ['organization', 'assigned_to'], ['organization', 'id'])


def downgrade() -> None:
    op.drop_constraint('fk_cases_assignee', 'cases', type_='foreignkey')
    op.drop_index('ix_cases_assignee', table_name='cases')
    op.drop_column('cases', 'assigned_to')
    op.drop_index(op.f('ix_auth_sessions_expires_at'), table_name='auth_sessions')
    op.drop_table('auth_sessions')
    op.drop_table('auth_users')
