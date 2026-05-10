"""ChatResponse must expose intelligence_request when set."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine
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


@pytest.mark.asyncio
async def test_response_includes_intelligence_request(client: AsyncClient) -> None:
    fake = ChatResult(
        text="I need data.",
        tx_cards=[],
        intelligence_request={
            "tool": "fetch_tweets",
            "args": {"query": "Česko Švédsko hokej", "max_items": 10},
            "price_usd": 0.50,
            "endpoint": "/v1/intelligence/tweets",
        },
    )
    with patch("api.routes.chat.run_chat", return_value=fake):
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": "find tweets"}]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "I need data."
    assert body["intelligence_request"]["tool"] == "fetch_tweets"
    assert body["intelligence_request"]["price_usd"] == 0.50
    assert body["intelligence_request"]["endpoint"] == "/v1/intelligence/tweets"


@pytest.mark.asyncio
async def test_response_intelligence_request_null_by_default(
    client: AsyncClient,
) -> None:
    fake = ChatResult(text="hi", tx_cards=[])
    with patch("api.routes.chat.run_chat", return_value=fake):
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": "hi"}]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["intelligence_request"] is None
