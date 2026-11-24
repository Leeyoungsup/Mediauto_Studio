"""add worklist dates and open history"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0008_worklist_filters'
down_revision = '0007_case_requests'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'worklist_opens',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('record_key', sa.String(length=90), nullable=False),
        sa.Column('opened_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'user_id', 'record_key'),
    )
    op.add_column('cases', sa.Column('accessioned_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('patients', sa.Column('sex', sa.String(length=16), nullable=True))
    op.add_column('specimens', sa.Column('collection_date', sa.Date(), nullable=True))
    op.add_column('worklist_preferences', sa.Column('sort_order', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('worklist_preferences', 'sort_order')
    op.drop_column('specimens', 'collection_date')
    op.drop_column('patients', 'sex')
    op.drop_column('cases', 'accessioned_at')
    op.drop_table('worklist_opens')
