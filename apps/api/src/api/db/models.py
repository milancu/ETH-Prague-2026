"""SQLModel tables.

Schema mirrors the SE-2 scaffold's CSV order book at
`apps/contracts/packages/nextjs/data/orders.csv` so frontend can swap the
local CSV-backed `/api/orders` route for this backend with no shape change.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(UTC)


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
