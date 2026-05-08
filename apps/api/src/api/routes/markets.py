"""Market metadata endpoints (`/markets`).

Off-chain mirror of on-chain markets. The FE creates a market on-chain via
`PredictionMarketV2.createMarket`, then POSTs the metadata here once the tx
confirms. This router stores what it gets, validates shape, and verifies the
`tx_hash` is mined and successful via `tx_verifier`.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, func, select

from api.db.models import Market
from api.db.session import get_session
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
        # SQLite stores naive datetimes; normalize tz-aware input to UTC and
        # drop the tz so the column write doesn't warn.
        if v.tzinfo is not None:
            v = v.astimezone(UTC).replace(tzinfo=None)
        return v


def _isoformat_z(dt: datetime) -> str:
    # Markets store naive UTC; emit RFC-3339 with `Z` so the FE parses it
    # as UTC instead of local time.
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


router = APIRouter(prefix="/markets", tags=["markets"])


@router.post(
    "",
    response_model=MarketCreateResponse,
    status_code=status.HTTP_201_CREATED,
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


@router.get("", response_model=MarketsListResponse)
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


@router.get("/{market_id}", response_model=MarketRead)
async def get_market(
    market_id: int,
    session: AsyncSession = Depends(get_session),
) -> Market:
    stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    if market is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="market not found"
        )
    return market
