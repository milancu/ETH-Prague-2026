"""merge heads (dice_commitments + indexer_checkpoints)

Revision ID: 0002_merge_heads
Revises: b2c3d4e5f6a7, b3c1f2d40a8e
Create Date: 2026-05-10 21:00:00.000000

"""
from typing import Sequence, Union


revision: str = '0002_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('b2c3d4e5f6a7', 'b3c1f2d40a8e')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
