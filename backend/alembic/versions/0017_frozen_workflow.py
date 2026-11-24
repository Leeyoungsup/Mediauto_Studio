"""add frozen publications and operating room receipts"""

from alembic import op
import sqlalchemy as sa


revision = '0017_frozen_workflow'
down_revision = '0016_case_reporting'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('frozen_publications',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('findings', sa.Text(), nullable=False),
        sa.Column('margins', sa.Text(), nullable=True),
        sa.Column('corrects_id', sa.Uuid(), nullable=True),
        sa.Column('correction_reason', sa.String(length=240), nullable=True),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'corrects_id'], ['frozen_publications.organization', 'frozen_publications.case_id', 'frozen_publications.id'], ),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'case_id', 'id'),
        sa.UniqueConstraint('organization', 'case_id', 'sequence'),
    )
    op.create_table('frozen_recipients',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(['organization', 'case_id'], ['cases.organization', 'cases.id'], ),
        sa.ForeignKeyConstraint(['organization', 'user_id'], ['auth_users.organization', 'auth_users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'user_id'),
    )
    op.create_index('ix_frozen_recipient_user', 'frozen_recipients', ['organization', 'user_id', 'active'], unique=False)
    op.create_table('frozen_callbacks',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('publication_id', sa.Uuid(), nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('outcome', sa.String(length=24), nullable=False),
        sa.Column('note', sa.String(length=240), nullable=True),
        sa.Column('request_key', sa.String(length=128), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("outcome IN ('reached_read_back','no_answer','failed')", name='frozen_callback_outcome'),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'publication_id'], ['frozen_publications.organization', 'frozen_publications.case_id', 'frozen_publications.id'], ),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'recipient_id'], ['frozen_recipients.organization', 'frozen_recipients.case_id', 'frozen_recipients.user_id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'created_by', 'request_key'),
    )
    op.create_index('ix_frozen_callback_publication', 'frozen_callbacks', ['organization', 'publication_id', 'created_at'], unique=False)
    op.create_table('frozen_receipts',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('publication_id', sa.Uuid(), nullable=False),
        sa.Column('recipient_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=True),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'acknowledged', 'failed')", name='frozen_receipt_status'),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'publication_id'], ['frozen_publications.organization', 'frozen_publications.case_id', 'frozen_publications.id'], ),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'recipient_id'], ['frozen_recipients.organization', 'frozen_recipients.case_id', 'frozen_recipients.user_id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'publication_id', 'recipient_id'),
    )


def downgrade() -> None:
    op.drop_table('frozen_receipts')
    op.drop_index('ix_frozen_callback_publication', table_name='frozen_callbacks')
    op.drop_table('frozen_callbacks')
    op.drop_index('ix_frozen_recipient_user', table_name='frozen_recipients')
    op.drop_table('frozen_recipients')
    op.drop_table('frozen_publications')
