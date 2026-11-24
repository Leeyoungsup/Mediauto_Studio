"""add blocks, scan labels, and QC state"""

from alembic import op
import sqlalchemy as sa


revision = '0010_case_editor'
down_revision = '0009_workgroups'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'specimen_blocks',
        sa.Column('specimen_id', sa.Uuid(), nullable=False),
        sa.Column('block_number', sa.String(length=80), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'specimen_id'], ['specimens.organization', 'specimens.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'specimen_id', 'block_number'),
        sa.UniqueConstraint('organization', 'specimen_id', 'id')
    )
    op.add_column('slide_scans', sa.Column('scanner', sa.String(length=120), nullable=True))
    op.add_column('slide_scans', sa.Column('qc_status', sa.String(length=24), server_default='unassessed', nullable=False))
    op.add_column('slide_scans', sa.Column('replaces_id', sa.Uuid(), nullable=True))
    op.create_unique_constraint('uq_scan_replacement', 'slide_scans', ['replaces_id'])
    op.create_unique_constraint('uq_scan_id_org', 'slide_scans', ['organization', 'id'])
    op.create_foreign_key('fk_scan_replaces', 'slide_scans', 'slide_scans', ['organization', 'replaces_id'], ['organization', 'id'])
    op.create_check_constraint('scan_qc_status', 'slide_scans', "qc_status IN ('unassessed','passed','hold','rescan_required','replaced')")
    op.create_table(
        'scan_labels',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('jpeg', sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'scan_id', 'version')
    )
    op.add_column('slides', sa.Column('block_id', sa.Uuid(), nullable=True))
    op.add_column('slides', sa.Column('barcode', sa.String(length=120), nullable=True))
    op.add_column('slides', sa.Column('label_text', sa.String(length=500), nullable=True))
    op.create_unique_constraint('uq_slide_barcode_org', 'slides', ['organization', 'barcode'])
    op.create_foreign_key('fk_slide_specimen_block', 'slides', 'specimen_blocks', ['organization', 'specimen_id', 'block_id'], ['organization', 'specimen_id', 'id'])
    op.create_check_constraint('slide_block_requires_specimen', 'slides', 'block_id IS NULL OR specimen_id IS NOT NULL')


def downgrade() -> None:
    op.drop_constraint('slide_block_requires_specimen', 'slides', type_='check')
    op.drop_constraint('fk_slide_specimen_block', 'slides', type_='foreignkey')
    op.drop_constraint('uq_slide_barcode_org', 'slides', type_='unique')
    op.drop_column('slides', 'label_text')
    op.drop_column('slides', 'barcode')
    op.drop_column('slides', 'block_id')
    op.drop_constraint('scan_qc_status', 'slide_scans', type_='check')
    op.drop_constraint('fk_scan_replaces', 'slide_scans', type_='foreignkey')
    op.drop_table('scan_labels')
    op.drop_constraint('uq_scan_id_org', 'slide_scans', type_='unique')
    op.drop_constraint('uq_scan_replacement', 'slide_scans', type_='unique')
    op.drop_column('slide_scans', 'replaces_id')
    op.drop_column('slide_scans', 'qc_status')
    op.drop_column('slide_scans', 'scanner')
    op.drop_table('specimen_blocks')
