"""related Pap and biopsy cases"""

from alembic import op
import sqlalchemy as sa


revision = '0026_related_case_links'
down_revision = '0025_pap_review'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('related_case_links',
        sa.Column('patient_id', sa.Uuid(), nullable=False),
        sa.Column('pap_case_id', sa.Uuid(), nullable=False),
        sa.Column('pap_specimen_id', sa.Uuid(), nullable=False),
        sa.Column('pap_scan_id', sa.Uuid(), nullable=False),
        sa.Column('biopsy_case_id', sa.Uuid(), nullable=False),
        sa.Column('biopsy_specimen_id', sa.Uuid(), nullable=False),
        sa.Column('biopsy_scan_id', sa.Uuid(), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=False),
        sa.Column('request_key', sa.Uuid(), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('revoked_by', sa.String(length=80), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoke_reason', sa.String(length=240), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint('pap_case_id <> biopsy_case_id AND pap_specimen_id <> biopsy_specimen_id AND pap_scan_id <> biopsy_scan_id', name='related_case_distinct_sources'),
        sa.ForeignKeyConstraint(['organization', 'biopsy_case_id', 'biopsy_specimen_id'], ['specimens.organization', 'specimens.case_id', 'specimens.id'], ),
        sa.ForeignKeyConstraint(['organization', 'biopsy_scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.ForeignKeyConstraint(['organization', 'pap_case_id', 'pap_specimen_id'], ['specimens.organization', 'specimens.case_id', 'specimens.id'], ),
        sa.ForeignKeyConstraint(['organization', 'pap_scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.ForeignKeyConstraint(['organization', 'patient_id'], ['patients.organization', 'patients.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'created_by', 'request_key')
    )
    op.create_index('ix_active_related_case_scans', 'related_case_links', ['organization', 'pap_scan_id', 'biopsy_scan_id'], unique=True, postgresql_where=sa.text('revoked_at IS NULL'))
    op.create_index('ix_related_case_biopsy', 'related_case_links', ['organization', 'biopsy_case_id'], unique=False)
    op.create_index('ix_related_case_pap', 'related_case_links', ['organization', 'pap_case_id'], unique=False)


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM related_case_links)")):
        raise RuntimeError("Archive related case links before downgrading.")
    op.drop_index('ix_related_case_pap', table_name='related_case_links')
    op.drop_index('ix_related_case_biopsy', table_name='related_case_links')
    op.drop_index('ix_active_related_case_scans', table_name='related_case_links', postgresql_where=sa.text('revoked_at IS NULL'))
    op.drop_table('related_case_links')
