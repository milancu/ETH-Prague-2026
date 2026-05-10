"""Tests for the static system prompt content."""

from __future__ import annotations

from unittest.mock import MagicMock

from api.llm.provider import SYSTEM_PROMPT, build_system_prompt
from api.llm.tool_registry import ToolContext


def _ctx(**overrides: object) -> ToolContext:
    base: dict[str, object] = {
        "session": MagicMock(),
        "client": MagicMock(),
        "chain_id": 31337,
    }
    base.update(overrides)
    return ToolContext(**base)  # type: ignore[arg-type]


def test_assistant_name_is_kowalski() -> None:
    assert "Kowalski" in SYSTEM_PROMPT
    assert "Kowalsky" not in SYSTEM_PROMPT


def test_prompt_mentions_request_intelligence() -> None:
    assert "request_intelligence" in SYSTEM_PROMPT


def test_prompt_includes_query_examples() -> None:
    # Concrete examples teach Gemini better than abstract rules.
    assert "Česko Švédsko hokej" in SYSTEM_PROMPT
    assert "IIHF" in SYSTEM_PROMPT  # the bad example


def test_prompt_describes_tool_result_protocol() -> None:
    assert "[tool_result" in SYSTEM_PROMPT


def test_prompt_forbids_auto_retry_on_empty_results() -> None:
    assert "Do NOT auto-retry" in SYSTEM_PROMPT


def test_build_system_prompt_user_address_optional() -> None:
    addr = "0x1234567890abcdef1234567890abcdef12345678"
    out = build_system_prompt(_ctx(user_address=addr))
    assert addr in out


def test_build_system_prompt_no_market_context() -> None:
    out = build_system_prompt(_ctx())
    assert "CURRENT MARKET CONTEXT" not in out


def test_build_system_prompt_with_market_context() -> None:
    market = {
        "market_id": 16,
        "title": "Jestli Česko vyhraje zápas nad Švédy",
        "category": "Sport",
        "outcome_type": "binary",
        "outcome_labels": ["No", "Yes"],
        "status": "pending",
        "expires_at": "2026-05-25T23:59:59Z",
    }
    out = build_system_prompt(_ctx(market_context=market))
    assert "CURRENT MARKET CONTEXT" in out
    assert "market #16" in out
    assert "Jestli Česko vyhraje zápas nad Švédy" in out
    assert "Sport" in out
    assert "binary" in out
    assert "2026-05-25T23:59:59Z" in out


def test_build_system_prompt_with_user_address_via_ctx() -> None:
    addr = "0x1234567890abcdef1234567890abcdef12345678"
    out = build_system_prompt(_ctx(user_address=addr))
    assert addr in out
