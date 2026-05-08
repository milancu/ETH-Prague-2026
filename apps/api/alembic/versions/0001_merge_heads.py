"""merge heads

Revision ID: 0001_merge_heads
Revises: 1e23c52420d1, 3cf957fbbe15
Create Date: 2026-05-09 00:00:00.000000

"""
from typing import Sequence, Union

revision: str = '0001_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('1e23c52420d1', '3cf957fbbe15')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass