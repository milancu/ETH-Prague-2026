"""Tests for /v1/chat market_id loading and validation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.models import Market
from api.db.session import SessionLocal, engine
from api.llm.provider import ChatResult


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


async def _seed_market(market_id: int = 16) -> None:
    async with SessionLocal() as session:
        m = Market(
            market_id=market_id,
            condition_id=f"0x{'a' * 64}",
            tx_hash=f"0x{'b' * 64}",
            chain_id=31337,
            creator=f"0x{'c' * 40}",
            title="Jestli Česko vyhraje zápas nad Švédy",
            description="Hokej",
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
async def test_chat_with_market_id_loads_context(client: AsyncClient) -> None:
    await _seed_market()
    captured: dict[str, Any] = {}

    async def fake_run_chat(messages: list[dict[str, str]], ctx: Any) -> ChatResult:
        captured["market_context"] = ctx.market_context
        return ChatResult(text="ok", tx_cards=[])

    with patch("api.routes.chat.run_chat", side_effect=fake_run_chat):
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "market_id": 16,
            },
        )
    assert resp.status_code == 200
    assert captured["market_context"] is not None
    assert captured["market_context"]["market_id"] == 16
    assert captured["market_context"]["title"] == "Jestli Česko vyhraje zápas nad Švédy"
    assert captured["market_context"]["category"] == "Sport"


@pytest.mark.asyncio
async def test_chat_without_market_id_has_no_context(client: AsyncClient) -> None:
    captured: dict[str, Any] = {}

    async def fake_run_chat(messages: list[dict[str, str]], ctx: Any) -> ChatResult:
        captured["market_context"] = ctx.market_context
        return ChatResult(text="ok", tx_cards=[])

    with patch("api.routes.chat.run_chat", side_effect=fake_run_chat):
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 200
    assert captured["market_context"] is None


@pytest.mark.asyncio
async def test_chat_with_unknown_market_id_returns_404(client: AsyncClient) -> None:
    fake = AsyncMock(return_value=ChatResult("x", []))
    with patch("api.routes.chat.run_chat", new=fake):
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "market_id": 9999,
            },
        )
    assert resp.status_code == 404
    assert "9999" in resp.json()["detail"]
