"""add worklist views and preferences"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0006_worklist_views'
down_revision = '0005_viewer_records'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'worklist_views',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('visibility', sa.String(length=12), nullable=False),
        sa.Column('configuration', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("visibility IN ('private', 'shared')", name='worklist_view_visibility'),
        sa.ForeignKeyConstraint(['organization', 'owner_id'], ['auth_users.organization', 'auth_users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_worklist_views_org_visibility', 'worklist_views', ['organization', 'visibility'], unique=False)
    op.create_table(
        'worklist_preferences',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('default_view_id', sa.Uuid(), nullable=True),
        sa.Column('columns', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['default_view_id'], ['worklist_views.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'user_id'),
    )


def downgrade() -> None:
    op.drop_table('worklist_preferences')
    op.drop_index('ix_worklist_views_org_visibility', table_name='worklist_views')
    op.drop_table('worklist_views')
