"""Verify market responses include both ENS names."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.models import Market
from api.db.session import SessionLocal, engine


@pytest.fixture(autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture
async def client():
    from api.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _seed(market_id: int, title: str) -> None:
    async with SessionLocal() as session:
        m = Market(
            market_id=market_id,
            condition_id=f"0x{'a' * 64}",
            tx_hash=f"0x{'b' * 64}",
            chain_id=84532,
            creator=f"0x{'c' * 40}",
            title=title,
            description="",
            rules="",
            category="Sport",
            outcome_type="binary",
            outcomes=[{"label": "No"}, {"label": "Yes"}],
            expires_at=datetime(2026, 5, 25, 23, 59, 59, tzinfo=UTC),
            resolution_time=datetime(2026, 5, 26, 23, 59, 59, tzinfo=UTC),
            status="pending",
            created_at=datetime(2026, 5, 10, 12, 0, 0, tzinfo=UTC),
        )
        session.add(m)
        await session.commit()


@pytest.mark.asyncio
async def test_market_get_includes_both_ens_names(client: AsyncClient) -> None:
    await _seed(42, "Jestli Česko vyhraje nad Švédy")
    resp = await client.get("/v1/markets/42")
    assert resp.status_code == 200
    body: dict[str, Any] = resp.json()
    assert body["ens_name"] == "jestli-cesko-vyhraje-nad-svedy.kowalski.eth"
    assert (
        body["ens_analysis_name"]
        == "analysis-jestli-cesko-vyhraje-nad-svedy.kowalski.eth"
    )


@pytest.mark.asyncio
async def test_market_list_includes_both_ens_names(client: AsyncClient) -> None:
    await _seed(7, "Bitcoin >200k")
    resp = await client.get("/v1/markets")
    assert resp.status_code == 200
    markets = resp.json()["markets"]
    assert len(markets) == 1
    assert markets[0]["ens_name"] == "bitcoin-200k.kowalski.eth"
    assert markets[0]["ens_analysis_name"] == "analysis-bitcoin-200k.kowalski.eth"
