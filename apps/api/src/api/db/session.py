"""Async DB engine and session factory.

`DATABASE_URL` env var picks the database; default is local SQLite via aiosqlite.
The engine and `SessionLocal` are module-level singletons. Routes acquire a
session through the `get_session()` FastAPI dependency.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./api.db"


def _make_engine() -> AsyncEngine:
    url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    kwargs: dict[str, object] = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        # `:memory:` SQLite gives every connection its own database, so multiple
        # sessions see different state. StaticPool reuses one connection across
        # the engine, which is what tests need.
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    return create_async_engine(url, **kwargs)


engine: AsyncEngine = _make_engine()

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an async session bound to `engine`."""
    async with SessionLocal() as session:
        yield session
