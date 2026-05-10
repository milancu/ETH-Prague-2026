"""Tests for ENSBridge checkpoint persistence + idempotency.

The bridge's `__init__` requires Sepolia env (signer key, registrar address, RPC),
so these tests instantiate the class via `object.__new__` and only exercise
the parts that touch the local DB.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlmodel import SQLModel

from api.db.models import IndexerCheckpoint
from api.db.session import SessionLocal, engine
from api.indexer.ens_bridge import (
    _CHECKPOINT_NAME,
    _DEFAULT_START_BLOCK,
    ENSBridge,
)


@pytest.fixture(autouse=True)
async def _schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


def _bare_bridge() -> ENSBridge:
    """Skip __init__ — only checkpoint methods are exercised below."""
    return object.__new__(ENSBridge)


@pytest.mark.asyncio
async def test_load_checkpoint_returns_default_minus_one_when_empty() -> None:
    bridge = _bare_bridge()
    block = await bridge._load_checkpoint()
    # The convention: from_block == loaded + 1, so first poll starts exactly at
    # _DEFAULT_START_BLOCK. Loading "default - 1" preserves that math.
    assert block == _DEFAULT_START_BLOCK - 1


@pytest.mark.asyncio
async def test_save_then_load_roundtrip() -> None:
    bridge = _bare_bridge()
    await bridge._save_checkpoint(41_300_000)
    assert await bridge._load_checkpoint() == 41_300_000


@pytest.mark.asyncio
async def test_save_checkpoint_is_upsert() -> None:
    bridge = _bare_bridge()
    await bridge._save_checkpoint(100)
    await bridge._save_checkpoint(200)
    await bridge._save_checkpoint(150)  # not monotonic — caller's job, not ours

    async with SessionLocal() as session:
        from sqlalchemy import select

        rows = (
            (
                await session.execute(
                    select(IndexerCheckpoint).where(
                        IndexerCheckpoint.name == _CHECKPOINT_NAME
                    )
                )
            )
            .scalars()
            .all()
        )
    # Exactly one row exists; latest write wins.
    assert len(rows) == 1
    assert rows[0].block_number == 150
