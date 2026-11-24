"""Pap review policy and history"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0025_pap_review'
down_revision = '0024_pap_gallery'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('pap_review_policies',
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('terms', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('permissions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'id'),
        sa.UniqueConstraint('organization', 'version')
    )
    op.create_table('pap_review_revisions',
        sa.Column('case_id', sa.Uuid(), nullable=False),
        sa.Column('specimen_id', sa.Uuid(), nullable=False),
        sa.Column('scan_id', sa.Uuid(), nullable=False),
        sa.Column('terminology_id', sa.Uuid(), nullable=False),
        sa.Column('policy_id', sa.Uuid(), nullable=False),
        sa.Column('action', sa.String(length=24), nullable=False),
        sa.Column('status', sa.String(length=24), nullable=False),
        sa.Column('findings', postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True),
        sa.Column('reason', sa.String(length=240), nullable=True),
        sa.Column('request_key', sa.Uuid(), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization', sa.String(length=64), nullable=False),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.String(length=80), nullable=False),
        sa.CheckConstraint("status IN ('primary_draft', 'submitted', 'followup_draft', 'returned', 'completed')", name='pap_review_status'),
        sa.ForeignKeyConstraint(['organization', 'case_id', 'specimen_id'], ['specimens.organization', 'specimens.case_id', 'specimens.id'], ),
        sa.ForeignKeyConstraint(['organization', 'policy_id'], ['pap_review_policies.organization', 'pap_review_policies.id'], ),
        sa.ForeignKeyConstraint(['organization', 'scan_id'], ['slide_scans.organization', 'slide_scans.id'], ),
        sa.ForeignKeyConstraint(['organization', 'terminology_id'], ['pap_review_policies.organization', 'pap_review_policies.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization', 'case_id', 'specimen_id', 'created_by', 'request_key'),
        sa.UniqueConstraint('organization', 'case_id', 'specimen_id', 'version')
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM pap_review_revisions) OR EXISTS (SELECT 1 FROM pap_review_policies)"
    )):
        raise RuntimeError("Archive Pap review policies and revisions before downgrading.")
    op.drop_table('pap_review_revisions')
    op.drop_table('pap_review_policies')
