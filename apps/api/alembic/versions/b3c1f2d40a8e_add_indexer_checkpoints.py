"""add_indexer_checkpoints

Revision ID: b3c1f2d40a8e
Revises: a981f4981d7a
Create Date: 2026-05-10 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = 'b3c1f2d40a8e'
down_revision: Union[str, Sequence[str], None] = 'a981f4981d7a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'indexer_checkpoints',
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('block_number', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('name'),
    )


def downgrade() -> None:
    op.drop_table('indexer_checkpoints')
