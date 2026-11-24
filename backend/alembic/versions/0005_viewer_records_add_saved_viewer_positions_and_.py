"""add saved viewer positions and annotations"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0005_viewer_records'
down_revision = '0004_emr_lis'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('viewer_annotations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('scan_key', sa.Uuid(), nullable=False),
        sa.Column('author_id', sa.Uuid(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('points', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('label', sa.String(length=160), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('length', sa.Float(), nullable=True),
        sa.Column('unit', sa.String(length=4), nullable=True),
        sa.Column('mpp_x', sa.Float(), nullable=True),
        sa.Column('mpp_y', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('rectangle', 'distance')", name='viewer_annotation_kind'),
        sa.ForeignKeyConstraint(['organization', 'author_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_viewer_annotations_scan', 'viewer_annotations', ['organization', 'scan_key', 'created_at'], unique=False)
    op.create_table('viewer_positions',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('scan_key', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('zoom', sa.Float(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('saved_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'scan_key', 'user_id'),
    )


def downgrade() -> None:
    op.drop_table('viewer_positions')
    op.drop_index('ix_viewer_annotations_scan', table_name='viewer_annotations')
    op.drop_table('viewer_annotations')
