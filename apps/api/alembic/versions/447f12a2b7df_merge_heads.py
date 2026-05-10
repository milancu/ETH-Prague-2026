"""merge_heads

Revision ID: 447f12a2b7df
Revises: b2c3d4e5f6a7, b3c1f2d40a8e
Create Date: 2026-05-10 08:50:16.548059

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '447f12a2b7df'
down_revision: Union[str, Sequence[str], None] = ('b2c3d4e5f6a7', 'b3c1f2d40a8e')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
