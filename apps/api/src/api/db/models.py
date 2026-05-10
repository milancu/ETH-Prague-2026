"""SQLModel tables.

Schema mirrors the SE-2 scaffold's CSV order book at
`apps/contracts/packages/nextjs/data/orders.csv` so frontend can swap the
local CSV-backed `/api/orders` route for this backend with no shape change.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(UTC)


class Market(SQLModel, table=True):
    """Off-chain metadata for an on-chain market.

    Created on-chain by `PredictionMarketV2.createMarket`; the FE POSTs this
    row immediately after the tx confirms. `market_id` and `condition_id`
    come from the on-chain event; `tx_hash` is unique per row.
    """

    __tablename__ = "markets"

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=_utc_now)

    market_id: int = Field(unique=True, index=True)
    condition_id: str = Field(unique=True, max_length=66)
    tx_hash: str = Field(unique=True, max_length=66)
    chain_id: int

    creator: str = Field(max_length=42)

    title: str
    description: str | None = None
    rules: str | None = None
    category: str = Field(max_length=50, index=True)

    outcome_type: str = Field(max_length=20, index=True)
    outcomes: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )

    scalar_min: float | None = None
    scalar_max: float | None = None
    scalar_unit: str | None = Field(default=None, max_length=20)
    current_value: float | None = None

    expires_at: datetime
    resolution_time: datetime

    status: str = Field(default="pending", max_length=20, index=True)


class Comment(SQLModel, table=True):
    """Off-chain comment on a market. Threaded via self-referential parent_id."""

    __tablename__ = "comments"

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=_utc_now)

    market_id: int = Field(index=True)
    parent_id: int | None = Field(default=None, foreign_key="comments.id", index=True)

    author: str = Field(max_length=42)
    content: str = Field(max_length=2000)


class Order(SQLModel, table=True):
    """CLOB maker order — off-chain signed (EIP-712), on-chain filled by `TabClob.fill`.

    Field types match the on-chain `Order` struct in `TabClob.sol:21-30`.
    `uint128` / `uint256` values arrive as decimal strings to avoid JSON's
    53-bit integer limit; `expiry` (`uint64`) fits in a Python int.
    """

    __tablename__ = "orders"

    id: str = Field(primary_key=True, max_length=64)
    created_at: datetime = Field(default_factory=_utc_now)

    # Optional: orders posted before market metadata existed have NULL here.
    market_id: int | None = Field(default=None, index=True)

    maker: str = Field(max_length=42)
    taker: str = Field(max_length=42)
    maker_token: str = Field(max_length=42)
    taker_token: str = Field(max_length=42)

    maker_amount: str = Field(max_length=80)
    taker_amount: str = Field(max_length=80)

    expiry: int

    salt: str = Field(max_length=80)
    chain_id: int
    verifying_contract: str = Field(max_length=42)
    signature: str = Field(max_length=132)
    note: str | None = Field(default=None, max_length=512)


class IndexerCheckpoint(SQLModel, table=True):
    """Last-processed block per indexer name. Read on startup, written after
    each successful poll. Without this the ENS bridge restarts from the
    current head and misses every event from before its last restart.
    """

    __tablename__ = "indexer_checkpoints"

    name: str = Field(primary_key=True, max_length=64)
    block_number: int
    updated_at: datetime = Field(default_factory=_utc_now)
