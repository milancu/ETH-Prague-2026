"""add dice_commitments

Revision ID: b2c3d4e5f6a7
Revises: a981f4981d7a
Create Date: 2026-05-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a981f4981d7a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('dice_commitments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('market_id', sa.Integer(), nullable=True),
    sa.Column('commitment_hash', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
    sa.Column('target_sequence', sa.Integer(), nullable=False),
    sa.Column('delay_minutes', sa.Float(), nullable=False),
    sa.Column('current_sequence', sa.Integer(), nullable=False),
    sa.Column('estimated_reveal_unix', sa.Integer(), nullable=False),
    sa.Column('ctrng', sa.JSON(), nullable=True),
    sa.Column('seed_hex', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=True),
    sa.Column('result', sa.Integer(), nullable=True),
    sa.Column('revealed_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('commitment_hash'),
    )
    op.create_index(op.f('ix_dice_commitments_market_id'), 'dice_commitments', ['market_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dice_commitments_market_id'), table_name='dice_commitments')
    op.drop_table('dice_commitments')
