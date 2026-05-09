"""Calldata builder endpoints (`/v1/prepare/*`).

Each POST returns a TxCard (for broadcast txs) or an OrderCard (for EIP-712
maker orders).  The agent signs and broadcasts; we never see a private key.

AI consent rule (docs/constitution.md §5 + §6 of ai_layer.md):
  Every response is calldata only.  The user clicks approve + signs in wallet.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from api.db.models import Market, Order
from api.db.session import get_session
from api.lib.web3_client import get_client
from api.llm.tools import prepare as prepare_tools

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_UINT_DEC_RE = re.compile(r"^[0-9]+$")


# ---------------------------------------------------------------------------
# Shared response models
# ---------------------------------------------------------------------------


class RequiredTx(BaseModel):
    to: str
    data: str
    summary: str


class TxCard(BaseModel):
    to: str
    data: str
    value: str = "0"
    chain_id: int
    summary: str
    requires: list[RequiredTx] = Field(default_factory=list)
    notice: str | None = None


class OrderCard(BaseModel):
    typed_data: dict[str, Any]
    approval: RequiredTx | None
    chain_id: int
    summary: str
    order_template: dict[str, Any]


# ---------------------------------------------------------------------------
# Request body models
# ---------------------------------------------------------------------------


class BuyRequest(BaseModel):
    market_id: int = Field(ge=0, description="On-chain market ID")
    slot: int = Field(ge=0, description="Outcome slot index (0=NO, 1=YES for binary)")
    amount_tab: str = Field(description="TAB to spend, in wei (decimal string)")
    user_address: str = Field(description="Taker wallet address")
    slippage_bps: int = Field(
        default=100, ge=0, le=10000, description="Max slippage in bps"
    )

    @field_validator("amount_tab")
    @classmethod
    def _validate_amount(cls, v: str) -> str:
        if not _UINT_DEC_RE.match(v) or int(v) == 0:
            raise ValueError("amount_tab must be a positive integer string (wei)")
        return v

    @field_validator("user_address")
    @classmethod
    def _validate_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be 0x-prefixed 40-hex-char address")
        return v.lower()


class SellRequest(BaseModel):
    market_id: int = Field(ge=0)
    slot: int = Field(ge=0)
    maker_amount: str = Field(description="Outcome tokens to sell, in wei")
    taker_amount: str = Field(description="TAB to receive, in wei")
    user_address: str
    expiry: int = Field(description="Order expiry as unix timestamp")

    @field_validator("maker_amount", "taker_amount")
    @classmethod
    def _validate_uint(cls, v: str) -> str:
        if not _UINT_DEC_RE.match(v) or int(v) == 0:
            raise ValueError("must be a positive integer string (wei)")
        return v

    @field_validator("user_address")
    @classmethod
    def _validate_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be 0x-prefixed 40-hex-char address")
        return v.lower()


OutcomeTypeLiteral = Literal["binary", "multi", "scalar"]
_OUTCOME_TYPE_INT = {"binary": 0, "multi": 1, "scalar": 2}


class CreateMarketRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str = Field(default="")
    category: str = Field(min_length=1, max_length=50)
    outcome_type: OutcomeTypeLiteral = "binary"
    outcome_slot_count: int = Field(ge=2, le=32)
    outcome_labels: list[str] = Field(min_length=2)
    oracle: str = Field(description="Address of the resolving oracle")
    expires_at: int = Field(description="Market expiry as unix timestamp")
    resolution_time: int = Field(description="Resolution deadline as unix timestamp")
    chain_id: int = Field(default=31337)

    @field_validator("oracle")
    @classmethod
    def _validate_oracle(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("oracle must be 0x-prefixed 40-hex-char address")
        return v.lower()


class ClaimRequest(BaseModel):
    market_id: int = Field(ge=0)
    index_sets: list[int] = Field(
        min_length=1, description="Winning outcome indexSets to redeem"
    )
    chain_id: int = Field(default=31337)


class MergeRequest(BaseModel):
    market_id: int = Field(ge=0)
    partition: list[int] = Field(
        default_factory=lambda: [1, 2],
        description=(
            "IndexSets that partition the full outcome set "
            "(default: [1,2] for binary)"
        ),
    )
    amount: str = Field(description="Collateral amount to recover, in wei")
    chain_id: int = Field(default=31337)

    @field_validator("amount")
    @classmethod
    def _validate_amount(cls, v: str) -> str:
        if not _UINT_DEC_RE.match(v) or int(v) == 0:
            raise ValueError("amount must be a positive integer string (wei)")
        return v


class CancelOrderRequest(BaseModel):
    order_id: str = Field(
        description="Off-chain order ID (from POST /v1/orders response)"
    )
    chain_id: int = Field(default=31337)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _raw_to_tx_card(raw: dict[str, Any]) -> TxCard:
    return TxCard(
        to=raw["to"],
        data=raw["data"],
        value=raw.get("value", "0"),
        chain_id=raw["chain_id"],
        summary=raw["summary"],
        requires=[RequiredTx(**r) for r in raw.get("requires", [])],
        notice=raw.get("notice"),
    )


async def _fetch_market(session: AsyncSession, market_id: int) -> Market:
    stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    if market is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"market {market_id} not found — "
                "register it via POST /v1/markets first"
            ),
        )
    return market


def _outcome_labels(market: Market) -> list[str]:
    return [str(o.get("label", i)) for i, o in enumerate(market.outcomes)]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/v1/prepare", tags=["free"])


# ---------------------------------------------------------------------------
# POST /v1/prepare/buy
# ---------------------------------------------------------------------------


@router.post(
    "/buy",
    response_model=TxCard,
    summary="Build buy calldata",
    description=(
        "Tries to fill from the CLOB order book; falls back to `PMv2.splitAndWrap` "
        "if insufficient liquidity. Returns a `TxCard` the agent signs and broadcasts."
    ),
)
async def prepare_buy(
    body: BuyRequest,
    session: AsyncSession = Depends(get_session),
) -> TxCard:
    market = await _fetch_market(session, body.market_id)
    labels = _outcome_labels(market)

    if body.slot >= len(market.outcomes):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"slot {body.slot} out of range "
                f"(market has {len(market.outcomes)} outcomes)"
            ),
        )

    orders_stmt = select(Order).where(Order.market_id == body.market_id)
    db_orders: list[Order] = list((await session.execute(orders_stmt)).scalars().all())

    client = get_client(market.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_buy,
            client,
            body.market_id,
            market.condition_id,
            body.slot,
            int(body.amount_tab),
            db_orders,
            market.chain_id,
            labels,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return _raw_to_tx_card(raw)


# ---------------------------------------------------------------------------
# POST /v1/prepare/sell
# ---------------------------------------------------------------------------


@router.post(
    "/sell",
    response_model=OrderCard,
    summary="Build sell maker order (EIP-712)",
    description=(
        "Returns an `OrderCard` with EIP-712 `typed_data` to sign with "
        "`eth_signTypedData_v4`.  The signed order is then posted to `POST /v1/orders`."
    ),
)
async def prepare_sell(
    body: SellRequest,
    session: AsyncSession = Depends(get_session),
) -> OrderCard:
    market = await _fetch_market(session, body.market_id)
    labels = _outcome_labels(market)

    if body.slot >= len(market.outcomes):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"slot {body.slot} out of range",
        )

    client = get_client(market.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_sell,
            client,
            body.market_id,
            market.condition_id,
            body.slot,
            int(body.maker_amount),
            int(body.taker_amount),
            body.user_address,
            body.expiry,
            market.chain_id,
            labels,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return OrderCard(
        typed_data=raw["typed_data"],
        approval=RequiredTx(**raw["approval"]) if raw.get("approval") else None,
        chain_id=raw["chain_id"],
        summary=raw["summary"],
        order_template=raw["order_template"],
    )


# ---------------------------------------------------------------------------
# POST /v1/prepare/create-market
# ---------------------------------------------------------------------------


@router.post(
    "/create-market",
    response_model=TxCard,
    summary="Build createMarket calldata",
    description=(
        "Encodes `PredictionMarketV2.createMarket(CreateMarketParams)`.  "
        "`requires` contains the prior `TAB.approve(PMv2, defaultBond)` tx."
    ),
)
async def prepare_create_market(
    body: CreateMarketRequest,
) -> TxCard:
    client = get_client(body.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_create_market,
            client,
            body.name,
            body.description,
            body.category,
            _OUTCOME_TYPE_INT[body.outcome_type],
            body.outcome_slot_count,
            body.outcome_labels,
            body.oracle,
            body.expires_at,
            body.resolution_time,
            body.chain_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return _raw_to_tx_card(raw)


# ---------------------------------------------------------------------------
# POST /v1/prepare/claim
# ---------------------------------------------------------------------------


@router.post(
    "/claim",
    response_model=TxCard,
    summary="Build claimWinnings calldata",
    description=(
        "Encodes `PredictionMarketV2.claimWinnings(marketId, indexSets)`.  "
        "`requires` contains the `CT.setApprovalForAll(PMv2, true)` precondition."
    ),
)
async def prepare_claim(body: ClaimRequest) -> TxCard:
    client = get_client(body.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_claim,
            client,
            body.market_id,
            body.index_sets,
            body.chain_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return _raw_to_tx_card(raw)


# ---------------------------------------------------------------------------
# POST /v1/prepare/merge
# ---------------------------------------------------------------------------


@router.post(
    "/merge",
    response_model=TxCard,
    summary="Build mergeFrom calldata",
    description=(
        "Encodes `PMv2.mergeFrom(marketId, partition, amount)` to recover "
        "TAB by burning a full position set. "
        "`partition` defaults to `[1, 2]` for binary markets."
    ),
)
async def prepare_merge(body: MergeRequest) -> TxCard:
    client = get_client(body.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_merge,
            client,
            body.market_id,
            body.partition,
            int(body.amount),
            body.chain_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return _raw_to_tx_card(raw)


# ---------------------------------------------------------------------------
# POST /v1/prepare/cancel-order
# ---------------------------------------------------------------------------


@router.post(
    "/cancel-order",
    response_model=TxCard,
    summary="Build cancel-order calldata",
    description="Encodes `TabClob.cancel(order)` for an existing maker order.",
)
async def prepare_cancel_order(
    body: CancelOrderRequest,
    session: AsyncSession = Depends(get_session),
) -> TxCard:
    order = await session.get(Order, body.order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"order {body.order_id!r} not found",
        )

    client = get_client(body.chain_id)

    try:
        raw = await asyncio.to_thread(
            prepare_tools.prepare_cancel_order,
            client,
            order,
            body.chain_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"calldata build failed: {exc}",
        ) from exc

    return _raw_to_tx_card(raw)
