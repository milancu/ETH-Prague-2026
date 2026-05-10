"""Verify ToolContext and ChatResult expose the new optional fields."""

from __future__ import annotations

from unittest.mock import MagicMock

from api.llm.provider import ChatResult
from api.llm.tool_registry import ToolContext


def test_tool_context_default_market_context_is_none() -> None:
    ctx = ToolContext(
        session=MagicMock(),
        client=MagicMock(),
        chain_id=31337,
    )
    assert ctx.market_context is None


def test_tool_context_default_intelligence_request_is_none() -> None:
    ctx = ToolContext(
        session=MagicMock(),
        client=MagicMock(),
        chain_id=31337,
    )
    assert ctx.intelligence_request is None


def test_tool_context_can_set_market_context() -> None:
    ctx = ToolContext(
        session=MagicMock(),
        client=MagicMock(),
        chain_id=31337,
    )
    ctx.market_context = {"market_id": 16, "title": "Test"}
    assert ctx.market_context["title"] == "Test"


def test_chat_result_default_intelligence_request_is_none() -> None:
    result = ChatResult(text="hi", tx_cards=[])
    assert result.intelligence_request is None


def test_chat_result_can_set_intelligence_request() -> None:
    req = {"tool": "fetch_tweets", "args": {"query": "x"}, "price_usd": 0.50}
    result = ChatResult(text="hi", tx_cards=[], intelligence_request=req)
    assert result.intelligence_request == req
