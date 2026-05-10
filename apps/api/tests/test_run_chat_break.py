"""run_chat must stop and return as soon as ctx.intelligence_request is set."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.llm.provider import ChatResult, run_chat
from api.llm.tool_registry import ToolContext


def _ctx() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        client=MagicMock(),
        chain_id=31337,
    )


def _fake_response_with_call(name: str, args: dict[str, object]) -> SimpleNamespace:
    """Construct a stand-in for genai's GenerateContentResponse."""
    fn_call = SimpleNamespace(name=name, args=args)
    candidate = SimpleNamespace(
        content=SimpleNamespace(role="model", parts=[]),
    )
    return SimpleNamespace(
        candidates=[candidate],
        function_calls=[fn_call],
        text=None,
    )


def _fake_response_text(text: str) -> SimpleNamespace:
    candidate = SimpleNamespace(content=SimpleNamespace(role="model", parts=[]))
    return SimpleNamespace(candidates=[candidate], function_calls=None, text=text)


@pytest.mark.asyncio
async def test_loop_breaks_when_intelligence_request_is_set() -> None:
    ctx = _ctx()

    # Fake genai client whose first response is a request_intelligence call,
    # subsequent responses would be plain text. We assert the loop exits
    # after the first round.
    mock_client = MagicMock()
    mock_models = MagicMock()
    mock_client.aio.models = mock_models

    call_count = 0

    async def fake_generate(**kwargs: object) -> SimpleNamespace:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return _fake_response_with_call(
                "request_intelligence",
                {"tool_name": "fetch_tweets", "query": "test"},
            )
        return _fake_response_text("should not reach")

    mock_models.generate_content = AsyncMock(side_effect=fake_generate)

    with patch("api.llm.provider._get_client", return_value=mock_client):
        result: ChatResult = await run_chat(
            [{"role": "user", "content": "find tweets"}], ctx
        )

    assert result.intelligence_request is not None
    assert result.intelligence_request["tool"] == "fetch_tweets"
    assert call_count == 1, "loop should have exited after first round"
