"""Tests for the static system prompt content."""

from __future__ import annotations

from api.llm.provider import SYSTEM_PROMPT, build_system_prompt


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
    out = build_system_prompt(user_address=addr)
    assert addr in out
