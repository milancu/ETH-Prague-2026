"""Smoke: [tool_result fetch_tweets] message must not trigger another paid request."""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine


@pytest.fixture(autouse=True)
async def _schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from api.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_tool_result_message_yields_text_response(client: AsyncClient) -> None:
    """When the model returns plain text (not a tool call), the route returns text."""

    def _text_response() -> SimpleNamespace:
        candidate = SimpleNamespace(content=SimpleNamespace(role="model", parts=[]))
        return SimpleNamespace(
            candidates=[candidate],
            function_calls=None,
            text="Based on the tweets, sentiment is mixed.",
        )

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=_text_response())

    with patch("api.llm.provider._get_client", return_value=mock_client):
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [
                    {"role": "user", "content": "find tweets about Česko Švédsko"},
                    {
                        "role": "assistant",
                        "content": "I need data. Confirm payment.",
                    },
                    {
                        "role": "user",
                        "content": (
                            "[tool_result fetch_tweets]: "
                            "{\"tweets\": [{\"text\": \"Go Czech!\"}]}"
                        ),
                    },
                ]
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["intelligence_request"] is None
    assert "sentiment" in body["text"].lower()
