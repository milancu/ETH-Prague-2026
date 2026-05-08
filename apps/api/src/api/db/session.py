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

DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./api.db"


def _make_engine() -> AsyncEngine:
    url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    connect_args: dict[str, object] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_async_engine(url, connect_args=connect_args, future=True)


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
