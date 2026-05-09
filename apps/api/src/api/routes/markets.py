"""Market metadata endpoints (`/v1/markets`) + TAB balance (`/v1/balance`).

Off-chain mirror of on-chain markets plus live chain-read endpoints for
positions and TAB balance.
"""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, func, select

from api.db.models import Market, Order
from api.db.session import get_session
from api.lib.web3_client import get_client
from api.llm.tools import chain as chain_tools
from api.llm.tools.chain import get_wrapper_address, index_set_for_slot
from api.llm.tools.orderbook import build_orderbook
from api.services.tx_verifier import (
    ALLOWED_CHAINS,
    TxVerificationError,
    TxVerifier,
    get_tx_verifier,
)

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_BYTES32_RE = re.compile(r"^0x[a-fA-F0-9]{64}$")
_TXHASH_RE = _BYTES32_RE

_INT64_MAX = (1 << 63) - 1

OutcomeType = Literal["binary", "multi", "scalar"]
MarketStatus = Literal["pending", "open", "resolved", "cancelled"]

_DEFAULT_CHAIN_ID = int(os.getenv("CHAIN_ID", "31337"))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class _Outcome(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    model_config = ConfigDict(extra="allow")


class MarketCreate(BaseModel):
    market_id: int = Field(ge=0, le=_INT64_MAX)
    condition_id: str
    tx_hash: str
    chain_id: int
    creator: str
    title: str = Field(min_length=1)
    description: str | None = None
    rules: str | None = None
    category: str = Field(min_length=1, max_length=50)
    outcome_type: OutcomeType
    outcomes: list[_Outcome] = Field(min_length=2)
    scalar_min: float | None = None
    scalar_max: float | None = None
    scalar_unit: str | None = Field(default=None, max_length=20)
    current_value: float | None = None
    expires_at: datetime
    resolution_time: datetime

    @field_validator("creator")
    @classmethod
    def _normalize_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be a 0x-prefixed 40-hex-char address")
        return v.lower()

    @field_validator("condition_id")
    @classmethod
    def _validate_condition_id(cls, v: str) -> str:
        if not _BYTES32_RE.match(v):
            raise ValueError("must be a 0x-prefixed 64-hex-char bytes32")
        return v.lower()

    @field_validator("tx_hash")
    @classmethod
    def _validate_tx_hash(cls, v: str) -> str:
        if not _TXHASH_RE.match(v):
            raise ValueError("must be a 0x-prefixed 64-hex-char tx hash")
        return v.lower()

    @field_validator("chain_id")
    @classmethod
    def _validate_chain_id(cls, v: int) -> int:
        if v not in ALLOWED_CHAINS:
            raise ValueError(f"chain_id must be one of {sorted(ALLOWED_CHAINS)}")
        return v

    @field_validator("expires_at", "resolution_time")
    @classmethod
    def _to_naive_utc(cls, v: datetime) -> datetime:
        if v.tzinfo is not None:
            v = v.astimezone(UTC).replace(tzinfo=None)
        return v


def _isoformat_z(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


class MarketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    market_id: int
    condition_id: str
    tx_hash: str
    chain_id: int
    creator: str
    title: str
    description: str | None
    rules: str | None
    category: str
    outcome_type: str
    outcomes: list[dict[str, object]]
    scalar_min: float | None
    scalar_max: float | None
    scalar_unit: str | None
    current_value: float | None
    expires_at: datetime
    resolution_time: datetime
    status: str
    created_at: datetime

    @field_serializer("expires_at", "resolution_time", "created_at")
    def _serialize_dt(self, v: datetime) -> str:
        return _isoformat_z(v)


class MarketCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    market_id: int
    status: str
    created_at: datetime

    @field_serializer("created_at")
    def _serialize_dt(self, v: datetime) -> str:
        return _isoformat_z(v)


class MarketsListResponse(BaseModel):
    markets: list[MarketRead]
    total: int
    page: int
    limit: int


class OrderbookEntry(BaseModel):
    order_id: str
    slot: int
    side: str
    maker: str
    maker_amount: str
    taker_amount: str
    price: str
    expiry: int


class OrderbookResponse(BaseModel):
    market_id: int
    bids: list[OrderbookEntry]
    asks: list[OrderbookEntry]


class PositionEntry(BaseModel):
    slot: int
    label: str
    index_set: int
    position_id: str
    wrapper_address: str | None
    balance_1155: str
    balance_wrapped: str


class PositionsResponse(BaseModel):
    market_id: int
    address: str
    positions: list[PositionEntry]


class BalanceResponse(BaseModel):
    address: str
    balance: str
    formatted: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_market_or_404(market: Market | None) -> Market:
    if market is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="market not found")
    return market


def _outcome_labels(market: Market) -> list[str]:
    return [str(o.get("label", i)) for i, o in enumerate(market.outcomes)]


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/v1/markets", tags=["free"])
balance_router = APIRouter(prefix="/v1/balance", tags=["free"])


# ---------------------------------------------------------------------------
# Market registration (POST) — unchanged behaviour
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=MarketCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a confirmed on-chain market",
    description=(
        "Store off-chain metadata for a market whose `createMarket` tx has confirmed. "
        "The `tx_hash` is verified on-chain before insertion."
    ),
)
async def create_market(
    body: MarketCreate,
    session: AsyncSession = Depends(get_session),
    verifier: TxVerifier = Depends(get_tx_verifier),
) -> Market:
    try:
        await verifier(body.chain_id, body.tx_hash)
    except TxVerificationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"tx verification failed: {e}",
        ) from e

    payload = body.model_dump()
    payload["outcomes"] = [o.model_dump() for o in body.outcomes]
    market = Market(**payload)
    session.add(market)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="market already exists",
        ) from e
    await session.refresh(market)
    return market


# ---------------------------------------------------------------------------
# GET /v1/markets — list
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=MarketsListResponse,
    summary="List markets",
    description="Paginated list of registered markets.  Filter by category, status, or outcome type.",
)
async def list_markets(
    session: AsyncSession = Depends(get_session),
    category: str | None = None,
    status_filter: MarketStatus | None = Query(default=None, alias="status"),
    outcome_type: OutcomeType | None = None,
    chain_id: int | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> MarketsListResponse:
    base_stmt = select(Market)
    count_stmt = select(func.count()).select_from(Market)
    if category is not None:
        base_stmt = base_stmt.where(Market.category == category)
        count_stmt = count_stmt.where(Market.category == category)
    if status_filter is not None:
        base_stmt = base_stmt.where(Market.status == status_filter)
        count_stmt = count_stmt.where(Market.status == status_filter)
    if outcome_type is not None:
        base_stmt = base_stmt.where(Market.outcome_type == outcome_type)
        count_stmt = count_stmt.where(Market.outcome_type == outcome_type)
    if chain_id is not None:
        base_stmt = base_stmt.where(Market.chain_id == chain_id)
        count_stmt = count_stmt.where(Market.chain_id == chain_id)

    total = (await session.execute(count_stmt)).scalar_one()
    page_stmt = (
        base_stmt.order_by(col(Market.created_at).desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    rows: Sequence[Market] = (await session.execute(page_stmt)).scalars().all()
    return MarketsListResponse(
        markets=[MarketRead.model_validate(m) for m in rows],
        total=total,
        page=page,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# GET /v1/markets/{market_id} — single detail
# ---------------------------------------------------------------------------


@router.get(
    "/{market_id}",
    response_model=MarketRead,
    summary="Get market detail",
    description="Full metadata for one market.  `market_id` is the on-chain integer ID.",
)
async def get_market(
    market_id: int,
    session: AsyncSession = Depends(get_session),
) -> Market:
    stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    return _get_market_or_404(market)


# ---------------------------------------------------------------------------
# GET /v1/markets/{market_id}/orderbook
# ---------------------------------------------------------------------------


@router.get(
    "/{market_id}/orderbook",
    response_model=OrderbookResponse,
    summary="CLOB order book for a market",
    description=(
        "Returns live (non-expired) bids and asks from the off-chain order mempool, "
        "sorted by price.  On-chain fill/cancel status is NOT verified in Phase 1 — "
        "assume stale orders may appear."
    ),
)
async def get_market_orderbook(
    market_id: int,
    session: AsyncSession = Depends(get_session),
) -> OrderbookResponse:
    stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    _get_market_or_404(market)
    assert market is not None  # for type narrowing

    orders_stmt = select(Order).where(Order.market_id == market_id)
    db_orders: list[Order] = list((await session.execute(orders_stmt)).scalars().all())

    client = get_client(market.chain_id)
    labels = _outcome_labels(market)
    slot_count = len(market.outcomes)

    # Resolve wrapper addresses for each slot — one chain call per slot
    def _get_wrappers() -> dict[int, str]:
        result: dict[int, str] = {}
        for slot in range(slot_count):
            index_set = index_set_for_slot(slot)
            addr = get_wrapper_address(client, market.condition_id, index_set)
            if addr:
                result[slot] = addr
        return result

    try:
        slot_wrapper_map = await asyncio.to_thread(_get_wrappers)
    except Exception:
        slot_wrapper_map = {}

    tab_address = client.tab.address.lower()
    book = build_orderbook(db_orders, tab_address, slot_wrapper_map)

    return OrderbookResponse(
        market_id=market_id,
        bids=[OrderbookEntry(**e) for e in book["bids"]],  # type: ignore[arg-type]
        asks=[OrderbookEntry(**e) for e in book["asks"]],  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# GET /v1/markets/{market_id}/positions/{address}
# ---------------------------------------------------------------------------


@router.get(
    "/{market_id}/positions/{address}",
    response_model=PositionsResponse,
    summary="User positions in a market",
    description=(
        "On-chain ERC-1155 and ERC-20 wrapped balances for each outcome slot.  "
        "Requires a running chain node."
    ),
)
async def get_user_positions(
    market_id: int,
    address: str,
    session: AsyncSession = Depends(get_session),
) -> PositionsResponse:
    if not _ADDR_RE.match(address):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="address must be a 0x-prefixed 40-hex-char address",
        )

    stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    _get_market_or_404(market)
    assert market is not None

    client = get_client(market.chain_id)
    labels = _outcome_labels(market)
    slot_count = len(market.outcomes)

    try:
        raw_positions = await asyncio.to_thread(
            chain_tools.get_user_positions,
            client,
            market.condition_id,
            slot_count,
            address,
            labels,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"chain read failed: {exc}",
        ) from exc

    return PositionsResponse(
        market_id=market_id,
        address=address.lower(),
        positions=[PositionEntry(**p) for p in raw_positions],  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# GET /v1/balance/{address}
# ---------------------------------------------------------------------------


@balance_router.get(
    "/{address}",
    response_model=BalanceResponse,
    summary="TAB balance",
    description="Returns raw (wei) and formatted TABcoin balance for an address.",
)
async def get_balance(address: str) -> BalanceResponse:
    if not _ADDR_RE.match(address):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="address must be a 0x-prefixed 40-hex-char address",
        )

    client = get_client(_DEFAULT_CHAIN_ID)
    try:
        result = await asyncio.to_thread(chain_tools.get_tab_balance, client, address)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"chain read failed: {exc}",
        ) from exc

    return BalanceResponse(address=address.lower(), **result)
