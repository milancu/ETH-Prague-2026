"""CLOB order mempool endpoints (`/orders`).

Off-chain signed `TabClob` orders live here between maker post and taker fill.
Wire shape mirrors the SE-2 scaffold's CSV order book at
`apps/contracts/packages/nextjs/data/orders.csv`. JSON is camelCase to match
that scaffold; Python attributes are snake_case via `to_camel` alias.
"""

from __future__ import annotations

import re
import secrets
import time
from collections.abc import Sequence
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from api.db.models import Order
from api.db.session import get_session

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_UINT_DEC_RE = re.compile(r"^[0-9]+$")
_SIG_RE = re.compile(r"^0x[a-fA-F0-9]{130}$")

_UINT64_MAX = (1 << 64) - 1
_UINT256_MAX = (1 << 256) - 1


def _new_order_id() -> str:
    """`<epoch_ms>-<6 hex chars>`. Matches scaffold's id shape closely enough."""
    return f"{int(time.time() * 1000)}-{secrets.token_hex(3)}"


class _CamelBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=to_camel,
        from_attributes=True,
    )


class OrderCreate(_CamelBase):
    maker: str
    taker: str
    maker_token: str
    taker_token: str
    maker_amount: str
    taker_amount: str
    expiry: int = Field(ge=0, le=_UINT64_MAX)
    salt: str
    chain_id: int = Field(ge=0)
    verifying_contract: str
    signature: str
    note: str | None = Field(default=None, max_length=512)
    # Optional so legacy orders posted before market metadata existed still work.
    market_id: int | None = Field(default=None, ge=0)

    @field_validator(
        "maker", "taker", "maker_token", "taker_token", "verifying_contract"
    )
    @classmethod
    def _validate_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be a 0x-prefixed 40-hex-char address")
        return v.lower()

    @field_validator("maker_amount", "taker_amount", "salt")
    @classmethod
    def _validate_uint256_decimal(cls, v: str) -> str:
        if not _UINT_DEC_RE.match(v):
            raise ValueError("must be a non-negative integer string")
        if int(v) > _UINT256_MAX:
            raise ValueError("exceeds uint256 max")
        return v

    @field_validator("signature")
    @classmethod
    def _validate_signature(cls, v: str) -> str:
        if not _SIG_RE.match(v):
            raise ValueError("must be a 0x-prefixed 130-hex-char (65-byte) signature")
        return v.lower()


class OrderRead(_CamelBase):
    id: str
    created_at: datetime
    maker: str
    taker: str
    maker_token: str
    taker_token: str
    maker_amount: str
    taker_amount: str
    expiry: int
    salt: str
    chain_id: int
    verifying_contract: str
    signature: str
    note: str | None
    market_id: int | None


router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    body: OrderCreate,
    session: AsyncSession = Depends(get_session),
) -> Order:
    # TODO(T3.5): SIWE auth + server-side EIP-712 signature verification.
    # On-chain `TabClob.fill` verifies the signature at fill time, and the
    # frontend revalidates before signing, so storing without verification
    # is acceptable for the hackathon mempool.
    order = Order(id=_new_order_id(), **body.model_dump())
    session.add(order)
    await session.commit()
    await session.refresh(order)
    return order


@router.get("", response_model=list[OrderRead])
async def list_orders(
    session: AsyncSession = Depends(get_session),
    market_id: int | None = Query(default=None, ge=0),
    maker: str | None = Query(default=None),
) -> Sequence[Order]:
    if maker is not None:
        if not _ADDR_RE.match(maker):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="maker must be a 0x-prefixed 40-hex-char address",
            )
        maker = maker.lower()

    stmt = select(Order)
    if market_id is not None:
        stmt = stmt.where(Order.market_id == market_id)
    if maker is not None:
        stmt = stmt.where(Order.maker == maker)
    stmt = stmt.order_by("created_at")

    result = await session.execute(stmt)
    return result.scalars().all()


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
) -> Order:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="order not found"
        )
    return order


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="order not found"
        )
    await session.delete(order)
    await session.commit()
