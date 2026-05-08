"""Smoke tests for the async DB plumbing."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from api.db.session import DEFAULT_DATABASE_URL, get_session


@pytest.fixture
async def in_memory_engine() -> AsyncEngine:
    return create_async_engine("sqlite+aiosqlite:///:memory:", future=True)


async def test_async_session_round_trips_select_1(
    in_memory_engine: AsyncEngine,
) -> None:
    SessionLocal = async_sessionmaker(
        bind=in_memory_engine, expire_on_commit=False
    )
    async with SessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        assert result.scalar_one() == 1


async def test_get_session_yields_usable_session() -> None:
    agen = get_session()
    session = await agen.__anext__()
    try:
        result = await session.execute(text("SELECT 1"))
        assert result.scalar_one() == 1
    finally:
        with pytest.raises(StopAsyncIteration):
            await agen.__anext__()


def test_default_url_is_sqlite_aiosqlite() -> None:
    assert DEFAULT_DATABASE_URL.startswith("sqlite+aiosqlite:")
