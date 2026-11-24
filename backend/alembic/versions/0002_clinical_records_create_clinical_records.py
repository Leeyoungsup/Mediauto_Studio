"""create clinical records"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0002_clinical_records'
down_revision = '0001_application_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'clinical_events',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('record_type', sa.String(length=24), nullable=False),
        sa.Column('record_id', sa.Uuid(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('actor', sa.String(length=80), nullable=False),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('before', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('after', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('transaction_id', sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'record_type', 'record_id', 'version'),
    )
    op.create_table(
        'clinical_registration_requests',
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('operation', sa.String(length=24), nullable=False),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('record_id', sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint('organization', 'operation', 'request_key'),
    )
    op.create_table(
        'patients',
        sa.Column('display_name', sa.String(length=120), nullable=True),
        sa.Column('local_reference', sa.String(length=80), nullable=True),
        sa.Column('birth_date', sa.Date(), nullable=True),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint('display_name IS NOT NULL OR local_reference IS NOT NULL', name='patient_minimum_identity'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'local_reference'),
    )
    op.create_table(
        'cases',
        sa.Column('case_number', sa.String(length=80), nullable=False),
        sa.Column('patient_id', sa.Uuid(), nullable=True),
        sa.Column('status', sa.String(length=24), server_default='registered', nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'patient_id'], ['patients.organization', 'patients.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_number'),
        sa.UniqueConstraint('organization', 'id'),
    )
    op.create_index('ix_cases_patient', 'cases', ['organization', 'patient_id'], unique=False)
    op.create_table(
        'specimens',
        sa.Column('specimen_number', sa.String(length=80), nullable=False),
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('description', sa.String(length=160), nullable=True),
        sa.Column('status', sa.String(length=24), server_default='registered', nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'specimen_number'),
        sa.UniqueConstraint('organization', 'id'),
    )
    op.create_table(
        'slides',
        sa.Column('slide_number', sa.String(length=80), nullable=False),
        sa.Column('specimen_id', sa.Uuid(), nullable=True),
        sa.Column('stain', sa.String(length=80), nullable=True),
        sa.Column('status', sa.String(length=24), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'specimen_id'], ['specimens.organization', 'specimens.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'specimen_id', 'slide_number'),
    )
    op.create_table(
        'external_identifiers',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('system', sa.String(length=120), nullable=False),
        sa.Column('kind', sa.String(length=64), nullable=False),
        sa.Column('value', sa.String(length=160), nullable=False),
        sa.Column('patient_id', sa.Uuid(), nullable=True),
        sa.Column('case_id', sa.Uuid(), nullable=True),
        sa.Column('specimen_id', sa.Uuid(), nullable=True),
        sa.Column('slide_id', sa.Uuid(), nullable=True),
        sa.Column('source', sa.String(length=24), nullable=False),
        sa.Column('linked_by', sa.String(length=80), nullable=False),
        sa.Column('first_received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('connection_state', sa.String(length=24), server_default='linked', nullable=False),
        sa.CheckConstraint('num_nonnulls(patient_id, case_id, specimen_id, slide_id) = 1', name='external_identifier_one_owner'),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id']),
        sa.ForeignKeyConstraint(['organization', 'patient_id'], ['patients.organization', 'patients.id']),
        sa.ForeignKeyConstraint(['organization', 'slide_id'], ['slides.organization', 'slides.id']),
        sa.ForeignKeyConstraint(['organization', 'specimen_id'], ['specimens.organization', 'specimens.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'system', 'kind', 'value'),
    )
    op.create_index('ix_external_identifiers_case', 'external_identifiers', ['organization', 'case_id'], unique=False)
    op.create_index('ix_external_identifiers_patient', 'external_identifiers', ['organization', 'patient_id'], unique=False)
    op.create_index('ix_external_identifiers_slide', 'external_identifiers', ['organization', 'slide_id'], unique=False)
    op.create_index('ix_external_identifiers_specimen', 'external_identifiers', ['organization', 'specimen_id'], unique=False)
    op.create_table(
        'slide_scans',
        sa.Column('slide_id', sa.Uuid(), nullable=False),
        sa.Column('storage_key', sa.String(length=512), nullable=False),
        sa.Column('format', sa.String(length=12), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('modified_ns', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(length=24), server_default='registered', nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'slide_id'], ['slides.organization', 'slides.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('storage_key'),
    )
    op.create_index('ix_slide_scans_slide', 'slide_scans', ['organization', 'slide_id'], unique=False)
    op.execute("""
        CREATE FUNCTION reject_clinical_event_changes() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'clinical_events is append-only';
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER clinical_events_append_only
        BEFORE UPDATE OR DELETE OR TRUNCATE ON clinical_events
        FOR EACH STATEMENT EXECUTE FUNCTION reject_clinical_event_changes()
    """)


def downgrade() -> None:
    op.drop_index('ix_slide_scans_slide', table_name='slide_scans')
    op.drop_table('slide_scans')
    op.drop_index('ix_external_identifiers_specimen', table_name='external_identifiers')
    op.drop_index('ix_external_identifiers_slide', table_name='external_identifiers')
    op.drop_index('ix_external_identifiers_patient', table_name='external_identifiers')
    op.drop_index('ix_external_identifiers_case', table_name='external_identifiers')
    op.drop_table('external_identifiers')
    op.drop_table('slides')
    op.drop_table('specimens')
    op.drop_index('ix_cases_patient', table_name='cases')
    op.drop_table('cases')
    op.drop_table('patients')
    op.drop_table('clinical_registration_requests')
    op.drop_table('clinical_events')
    op.execute('DROP FUNCTION reject_clinical_event_changes()')
