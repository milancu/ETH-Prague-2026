"""Tests for request_intelligence (free pseudo-tool emitting a payment request)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from api.llm.tool_registry import ToolContext, get_tool_map


def _ctx() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        client=MagicMock(),
        chain_id=31337,
    )


def test_request_intelligence_is_registered() -> None:
    tool_map = get_tool_map()
    assert "request_intelligence" in tool_map


def test_paid_apify_tools_are_removed() -> None:
    tool_map = get_tool_map()
    for name in (
        "fetch_tweets",
        "fetch_reddit",
        "fetch_news",
        "analyze_market",
        "markets_with_buzz",
    ):
        assert name not in tool_map, f"{name} should be removed"


@pytest.mark.asyncio
async def test_request_intelligence_populates_context() -> None:
    ctx = _ctx()
    fn = get_tool_map()["request_intelligence"]
    result = await fn(
        {"tool_name": "fetch_tweets", "query": "Česko Švédsko hokej", "max_items": 10},
        ctx,
    )
    assert ctx.intelligence_request is not None
    assert ctx.intelligence_request["tool"] == "fetch_tweets"
    assert ctx.intelligence_request["args"]["query"] == "Česko Švédsko hokej"
    assert ctx.intelligence_request["args"]["max_items"] == 10
    assert ctx.intelligence_request["price_usd"] == 0.50
    assert ctx.intelligence_request["endpoint"] == "/v1/intelligence/tweets"
    assert result["status"] == "payment_required"


@pytest.mark.asyncio
async def test_request_intelligence_premium_price_for_buzz() -> None:
    ctx = _ctx()
    fn = get_tool_map()["request_intelligence"]
    await fn(
        {"tool_name": "markets_with_buzz", "query": "ignored", "max_items": 5},
        ctx,
    )
    assert ctx.intelligence_request is not None
    assert ctx.intelligence_request["price_usd"] == 0.75
    assert ctx.intelligence_request["endpoint"] == "/v1/intelligence/markets-with-buzz"


@pytest.mark.asyncio
async def test_request_intelligence_unknown_tool_raises() -> None:
    ctx = _ctx()
    fn = get_tool_map()["request_intelligence"]
    with pytest.raises(ValueError, match="unknown intelligence tool"):
        await fn({"tool_name": "bogus_tool", "query": "x"}, ctx)


@pytest.mark.asyncio
async def test_request_intelligence_default_max_items() -> None:
    ctx = _ctx()
    fn = get_tool_map()["request_intelligence"]
    await fn({"tool_name": "fetch_news", "query": "Bitcoin"}, ctx)
    assert ctx.intelligence_request is not None
    assert ctx.intelligence_request["args"]["max_items"] == 10
