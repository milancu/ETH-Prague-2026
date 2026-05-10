"""DB-backed market and order query helpers for the LLM tool surface.

These are async because they hit the DB via SQLAlchemy async sessions.
They return plain dicts (Pydantic validation happens at the route layer).
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from api.db.models import Market, Order


async def list_markets(
    session: AsyncSession,
    category: str | None = None,
    status: str | None = None,
    limit: int = 20,
) -> list[dict[str, object]]:
    """Return a page of markets, optionally filtered."""
    stmt = select(Market)
    if category is not None:
        stmt = stmt.where(Market.category == category)
    if status is not None:
        stmt = stmt.where(Market.status == status)
    stmt = stmt.order_by(col(Market.created_at).desc()).limit(limit)
    rows: Sequence[Market] = (await session.execute(stmt)).scalars().all()
    return [
        {
            "market_id": m.market_id,
            "title": m.title,
            "category": m.category,
            "status": m.status,
            "outcome_type": m.outcome_type,
            "outcomes": m.outcomes,
            "expires_at": m.expires_at.isoformat(),
        }
        for m in rows
    ]


async def get_market(
    session: AsyncSession,
    market_id: int,
) -> dict[str, object] | None:
    """Return full metadata for one market, or None."""
    stmt = select(Market).where(Market.market_id == market_id)
    m = (await session.execute(stmt)).scalar_one_or_none()
    if m is None:
        return None
    return {
        "market_id": m.market_id,
        "condition_id": m.condition_id,
        "title": m.title,
        "description": m.description,
        "category": m.category,
        "status": m.status,
        "outcome_type": m.outcome_type,
        "outcomes": m.outcomes,
        "chain_id": m.chain_id,
        "expires_at": m.expires_at.isoformat(),
        "resolution_time": m.resolution_time.isoformat(),
        "creator": m.creator,
    }


async def search_markets(
    session: AsyncSession,
    query: str,
    limit: int = 10,
) -> list[dict[str, object]]:
    """Simple LIKE search on market title."""
    stmt = (
        select(Market)
        .where(Market.title.ilike(f"%{query}%"))  # type: ignore[union-attr]
        .order_by(col(Market.created_at).desc())
        .limit(limit)
    )
    rows: Sequence[Market] = (await session.execute(stmt)).scalars().all()
    return [
        {
            "market_id": m.market_id,
            "title": m.title,
            "category": m.category,
            "status": m.status,
            "outcomes": m.outcomes,
        }
        for m in rows
    ]


async def get_market_status(
    session: AsyncSession,
    market_id: int,
) -> dict[str, object] | None:
    """Return market status + resolution info."""
    stmt = select(Market).where(Market.market_id == market_id)
    m = (await session.execute(stmt)).scalar_one_or_none()
    if m is None:
        return None
    return {
        "market_id": m.market_id,
        "title": m.title,
        "status": m.status,
        "expires_at": m.expires_at.isoformat(),
        "resolution_time": m.resolution_time.isoformat(),
    }


async def list_orders(
    session: AsyncSession,
    market_id: int | None = None,
    maker: str | None = None,
) -> list[dict[str, object]]:
    """Return orders, optionally filtered by market or maker."""
    stmt = select(Order)
    if market_id is not None:
        stmt = stmt.where(Order.market_id == market_id)
    if maker is not None:
        stmt = stmt.where(Order.maker == maker.lower())
    stmt = stmt.order_by(Order.created_at)
    rows: Sequence[Order] = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": o.id,
            "market_id": o.market_id,
            "maker": o.maker,
            "maker_token": o.maker_token,
            "taker_token": o.taker_token,
            "maker_amount": o.maker_amount,
            "taker_amount": o.taker_amount,
            "expiry": o.expiry,
        }
        for o in rows
    ]


async def get_market_model(
    session: AsyncSession,
    market_id: int,
) -> Market | None:
    """Return the raw Market ORM object (needed by prepare_* tools)."""
    stmt = select(Market).where(Market.market_id == market_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_orders_for_market(
    session: AsyncSession,
    market_id: int,
) -> list[Order]:
    """Return all Order rows for a market (needed by prepare_buy)."""
    stmt = select(Order).where(Order.market_id == market_id)
    return list((await session.execute(stmt)).scalars().all())
