"""Pap gallery cursor"""

from alembic import op
import sqlalchemy as sa


revision = '0024_pap_gallery'
down_revision = '0023_skin_review'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('pap_gallery_cursors',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('archive_id', sa.String(length=64), nullable=False),
        sa.Column('candidate_id', sa.String(length=80), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('saved_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('organization', 'user_id', 'case_id', 'scan_id')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM pap_gallery_cursors)")):
        raise RuntimeError("Archive Pap gallery cursors before downgrading.")
    op.drop_table('pap_gallery_cursors')
