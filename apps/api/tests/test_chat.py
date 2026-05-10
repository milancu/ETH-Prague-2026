"""Tests for POST /v1/chat (Kowalsky in-app chat)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.llm.provider import ChatResult, build_system_prompt
from api.llm.tool_registry import ToolContext


def _ctx(**overrides: object) -> ToolContext:
    base: dict[str, object] = {
        "session": MagicMock(),
        "client": MagicMock(),
        "chain_id": 31337,
    }
    base.update(overrides)
    return ToolContext(**base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_chat_result() -> ChatResult:
    return ChatResult(text="Hello from Kowalsky!", tx_cards=[])


@pytest.fixture
def mock_chat_result_with_tx() -> ChatResult:
    return ChatResult(
        text="I prepared a buy for you.",
        tx_cards=[
            {
                "to": "0x1234567890abcdef1234567890abcdef12345678",
                "data": "0xdeadbeef",
                "value": "0",
                "chain_id": 31337,
                "summary": "Buy 10 YES tokens in market #1",
                "requires": [],
            }
        ],
    )


@pytest.fixture
def app() -> Any:
    from api.main import app as _app

    return _app


@pytest.fixture
async def client(app: Any) -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_returns_text_and_tx_cards(
    client: AsyncClient, mock_chat_result: ChatResult
) -> None:
    with patch("api.routes.chat.run_chat", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = mock_chat_result
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": "Hello"}]},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert "tx_cards" in data
    assert data["text"] == "Hello from Kowalsky!"
    assert data["tx_cards"] == []


@pytest.mark.asyncio
async def test_chat_with_tx_card(
    client: AsyncClient, mock_chat_result_with_tx: ChatResult
) -> None:
    with patch("api.routes.chat.run_chat", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = mock_chat_result_with_tx
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [{"role": "user", "content": "Buy 10 TAB on Yes"}],
                "user_address": "0x1234567890abcdef1234567890abcdef12345678",
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tx_cards"]) == 1
    assert data["tx_cards"][0]["summary"] == "Buy 10 YES tokens in market #1"
    assert data["tx_cards"][0]["to"] == "0x1234567890abcdef1234567890abcdef12345678"


@pytest.mark.asyncio
async def test_system_prompt_contains_hard_rules() -> None:
    prompt = build_system_prompt(_ctx())
    assert "HARD RULES" in prompt
    assert "Never reference a market" in prompt
    assert "Never propose a transaction without first calling a `prepare_*` tool" in prompt
    assert "Never guess" in prompt
    assert "TxCard" in prompt


@pytest.mark.asyncio
async def test_system_prompt_includes_user_address() -> None:
    addr = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    prompt = build_system_prompt(_ctx(user_address=addr))
    assert addr in prompt


@pytest.mark.asyncio
async def test_input_sanitization_control_chars(
    client: AsyncClient, mock_chat_result: ChatResult
) -> None:
    with patch("api.routes.chat.run_chat", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = mock_chat_result
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [
                    {"role": "user", "content": "Hello\x00\x01\x02 world\x7f"}
                ]
            },
        )
    assert resp.status_code == 200
    call_args = mock_run.call_args
    messages = call_args[0][0]
    assert "\x00" not in messages[0]["content"]
    assert "\x01" not in messages[0]["content"]
    assert "\x7f" not in messages[0]["content"]
    assert "Hello" in messages[0]["content"]
    assert "world" in messages[0]["content"]


@pytest.mark.asyncio
async def test_input_sanitization_long_message(
    client: AsyncClient, mock_chat_result: ChatResult
) -> None:
    long_msg = "a" * 3000
    with patch("api.routes.chat.run_chat", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = mock_chat_result
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": long_msg}]},
        )
    # Pydantic max_length=2000 rejects at validation
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_user_address(client: AsyncClient) -> None:
    resp = await client.post(
        "/v1/chat",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "user_address": "not-an-address",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_empty_messages(client: AsyncClient) -> None:
    resp = await client.post("/v1/chat", json={"messages": []})
    assert resp.status_code == 422
