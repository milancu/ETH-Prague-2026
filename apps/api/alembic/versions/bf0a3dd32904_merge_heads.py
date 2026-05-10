"""merge_heads

Revision ID: bf0a3dd32904
Revises: 0002_merge_heads, 447f12a2b7df
Create Date: 2026-05-10 09:14:38.799143

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'bf0a3dd32904'
down_revision: Union[str, Sequence[str], None] = ('0002_merge_heads', '447f12a2b7df')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
