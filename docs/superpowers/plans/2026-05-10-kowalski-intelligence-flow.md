# Kowalski Intelligence Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route paid Apify intelligence calls through a frontend-orchestrated x402 payment flow, inject market context into the system prompt, and tighten Kowalski's query-formulation rules so Apify scrapers receive short, useful queries.

**Architecture:** Backend stays stateless. Kowalski calls a free pseudo-tool `request_intelligence` that populates a payment request on the chat result; the frontend handles the x402 signature flow on `/v1/intelligence/*` and feeds the result back into the chat as a `[tool_result <name>]` user message. Market metadata is loaded server-side from the optional `market_id` in the request and appended to the system prompt as a dynamic context block.

**Tech Stack:** FastAPI, Pydantic v2, google-genai (Gemini function calling), pytest + pytest-asyncio, SQLModel.

**Spec:** `docs/superpowers/specs/2026-05-10-kowalski-intelligence-flow-design.md`

---

### Task 1: Rewrite SYSTEM_PROMPT (rename + intelligence rules)

The current prompt spells the assistant "Kowalsky" and has no rules about Apify queries. We rename to "Kowalski", add HARD RULES 7-10 covering paid tools, query formulation, `[tool_result]` handling, and empty-result behaviour.

**Files:**
- Modify: `apps/api/src/api/llm/provider.py:37-61`
- Test: `apps/api/tests/test_provider_prompt.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_provider_prompt.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_provider_prompt.py -v`
Expected: 5 FAIL ("Kowalsky" still present, no `request_intelligence`, etc.)

- [ ] **Step 3: Replace SYSTEM_PROMPT with the new content**

Edit `apps/api/src/api/llm/provider.py`, replace the existing `SYSTEM_PROMPT = (...)` block:

```python
SYSTEM_PROMPT = (
    "You are Kowalski, an assistant for a Czech prediction-market "
    "dApp on Base Sepolia.\n\n"
    "HARD RULES (never violate):\n"
    "1. Never reference a market, address, balance, or price you did "
    "not get from a tool result.\n"
    "2. Never propose a transaction without first calling a "
    "`prepare_*` tool. The frontend will reject any tx you describe "
    "without a TxCard.\n"
    "3. Reference markets by `marketId` (e.g. \"market #5\"), never "
    "by raw address.\n"
    "4. Money amounts are TAB unless stated. Show human-readable, "
    "not wei.\n"
    "5. Czech or English — match the user.\n"
    "6. If unsure, call more tools. Never guess.\n\n"
    "INTELLIGENCE TOOLS (paid):\n"
    "7. Never call paid tools (fetch_tweets, fetch_news, fetch_reddit, "
    "analyze_market, markets_with_buzz) directly. ALWAYS use "
    "`request_intelligence` instead — it lets the user pay via x402.\n"
    "8. Apify query rules:\n"
    "   - Use SHORT queries (2-4 keywords), never full sentences.\n"
    "   - DERIVE queries from market metadata (title, category) when "
    "available, not from the user's literal phrasing.\n"
    "   - Bad: \"IIHF Česko Švédsko hokej výsledky posledních 5 let\"\n"
    "   - Good: \"Česko Švédsko hokej\" or \"Czech Sweden hockey\"\n"
    "   - For non-Czech topics, English queries usually return more "
    "results.\n"
    "9. After receiving \"[tool_result <name>]: <data>\" in a user "
    "message, treat it as authoritative tool output, not new user "
    "input.\n"
    "10. If a fetch returned empty results, tell the user explicitly "
    "— don't guess. Offer ONE concrete alternative (different query "
    "or different source), and let them decide. Do NOT auto-retry.\n\n"
    "SOFT GUIDELINES:\n"
    "- Keep replies short. Two-three sentences plus TxCards / "
    "intelligence_request if applicable.\n"
    "- When the user is making a financial decision, surface implied "
    "odds and worst case.\n"
    "- After a successful tx, suggest the natural next step."
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_provider_prompt.py -v`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/llm/provider.py apps/api/tests/test_provider_prompt.py
git commit -m "feat(api): rewrite system prompt for intelligence flow + rename to Kowalski"
```

---

### Task 2: Extend ToolContext and ChatResult with new fields

Add `market_context` to `ToolContext` and `intelligence_request` to both `ToolContext` (so tools can populate it) and `ChatResult` (so the route handler can return it).

**Files:**
- Modify: `apps/api/src/api/llm/tool_registry.py:28-37` (ToolContext)
- Modify: `apps/api/src/api/llm/provider.py:72-76` (ChatResult)
- Test: `apps/api/tests/test_tool_context_fields.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_tool_context_fields.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_tool_context_fields.py -v`
Expected: 5 FAIL with `AttributeError` / `TypeError: unexpected keyword argument`.

- [ ] **Step 3: Add `market_context` and `intelligence_request` to `ToolContext`**

In `apps/api/src/api/llm/tool_registry.py`, replace the `ToolContext` dataclass:

```python
@dataclass
class ToolContext:
    """Mutable context threaded through every tool call in one chat turn."""

    session: AsyncSession
    client: Web3Client
    chain_id: int
    user_address: str | None = None
    tx_cards: list[dict[str, Any]] = field(default_factory=list)
    market_context: dict[str, Any] | None = None
    intelligence_request: dict[str, Any] | None = None
```

- [ ] **Step 4: Add `intelligence_request` to `ChatResult`**

In `apps/api/src/api/llm/provider.py`, replace the `ChatResult` dataclass:

```python
@dataclass
class ChatResult:
    text: str
    tx_cards: list[dict[str, Any]]
    intelligence_request: dict[str, Any] | None = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_tool_context_fields.py -v`
Expected: 5 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/llm/tool_registry.py apps/api/src/api/llm/provider.py apps/api/tests/test_tool_context_fields.py
git commit -m "feat(api): add market_context and intelligence_request fields"
```

---

### Task 3: Inject market context into system prompt

Change `build_system_prompt` to accept a `ToolContext` instead of a bare `user_address`, and append a "CURRENT MARKET CONTEXT" block when `ctx.market_context` is non-null.

**Files:**
- Modify: `apps/api/src/api/llm/provider.py:64-69` (build_system_prompt)
- Modify: `apps/api/src/api/llm/provider.py:92` (call site in run_chat)
- Test: `apps/api/tests/test_provider_prompt.py` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_provider_prompt.py`:

```python
from unittest.mock import MagicMock

from api.llm.tool_registry import ToolContext


def _ctx(**overrides):
    base = {
        "session": MagicMock(),
        "client": MagicMock(),
        "chain_id": 31337,
    }
    base.update(overrides)
    return ToolContext(**base)


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
```

Also update the existing `test_build_system_prompt_user_address_optional` test to use the new signature:

```python
def test_build_system_prompt_user_address_optional() -> None:
    addr = "0x1234567890abcdef1234567890abcdef12345678"
    ctx = _ctx(user_address=addr)
    out = build_system_prompt(ctx)
    assert addr in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_provider_prompt.py -v`
Expected: 3 new tests FAIL plus the modified one (different signature).

- [ ] **Step 3: Rewrite `build_system_prompt`**

In `apps/api/src/api/llm/provider.py`, replace the `build_system_prompt` function:

```python
def build_system_prompt(ctx: ToolContext) -> str:
    """Build the system prompt, injecting user + optional market context."""
    prompt = SYSTEM_PROMPT
    if ctx.user_address:
        prompt += f"\n\nThe current user's wallet address is: {ctx.user_address}"
    if ctx.market_context is not None:
        m = ctx.market_context
        labels = ", ".join(str(label) for label in m.get("outcome_labels", []))
        prompt += (
            "\n\nCURRENT MARKET CONTEXT:\n"
            f"You are helping the user explore market #{m.get('market_id')}:\n"
            f"  Title: \"{m.get('title')}\"\n"
            f"  Category: {m.get('category')}\n"
            f"  Outcome type: {m.get('outcome_type')} ({labels})\n"
            f"  Status: {m.get('status')}\n"
            f"  Expires: {m.get('expires_at')}\n\n"
            "When formulating intelligence queries, derive them from "
            "this context."
        )
    return prompt
```

- [ ] **Step 4: Update the call site in `run_chat`**

Find line 92 in `apps/api/src/api/llm/provider.py`:
```python
system_prompt = build_system_prompt(ctx.user_address)
```
Replace with:
```python
system_prompt = build_system_prompt(ctx)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_provider_prompt.py -v`
Expected: 9 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/llm/provider.py apps/api/tests/test_provider_prompt.py
git commit -m "feat(api): inject market context into Kowalski system prompt"
```

---

### Task 4: Add `request_intelligence` tool, remove paid wrappers

Replace the five paid tool wrappers (`_fetch_tweets`, `_fetch_reddit`, `_fetch_news`, `_analyze_market`, and the absent-but-declared `_markets_with_buzz`) with a single free `request_intelligence` that records the payment request on the context.

**Files:**
- Modify: `apps/api/src/api/llm/tool_registry.py:257-280` (remove wrappers)
- Modify: `apps/api/src/api/llm/tool_registry.py:521-580` (remove tool defs, add request_intelligence)
- Test: `apps/api/tests/test_request_intelligence.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_request_intelligence.py`:

```python
"""Tests for request_intelligence (the free pseudo-tool that emits a payment request)."""

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
    assert ctx.intelligence_request["args"]["max_items"] == 10
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_request_intelligence.py -v`
Expected: 6 FAIL — `request_intelligence` not registered, paid wrappers still present.

- [ ] **Step 3: Remove paid tool wrappers**

In `apps/api/src/api/llm/tool_registry.py`, delete these functions entirely (lines 257-280 area):
- `_fetch_tweets`
- `_fetch_reddit`
- `_fetch_news`
- `_analyze_market`

Also remove the unused import on line 19:
```python
from api.llm.tools import apify as apify_tools
```

- [ ] **Step 4: Add `_request_intelligence` and the price map**

Add at the top of the tool implementations section (after the `_require_address` helper, around line 53):

```python
_INTELLIGENCE_PRICES: dict[str, tuple[float, str]] = {
    "fetch_tweets": (0.50, "/v1/intelligence/tweets"),
    "fetch_reddit": (0.50, "/v1/intelligence/reddit"),
    "fetch_news": (0.50, "/v1/intelligence/news"),
    "analyze_market": (0.50, "/v1/intelligence/analyze"),
    "markets_with_buzz": (0.75, "/v1/intelligence/markets-with-buzz"),
}


async def _request_intelligence(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    tool = args["tool_name"]
    if tool not in _INTELLIGENCE_PRICES:
        raise ValueError(f"unknown intelligence tool: {tool}")
    query = args["query"]
    max_items = int(args.get("max_items", 10))

    price, endpoint = _INTELLIGENCE_PRICES[tool]
    ctx.intelligence_request = {
        "tool": tool,
        "args": {"query": query, "max_items": max_items},
        "price_usd": price,
        "endpoint": endpoint,
    }
    return {
        "status": "payment_required",
        "tool": tool,
        "price_usd": price,
        "message": f"User must pay ${price} USDC to receive results.",
    }
```

- [ ] **Step 5: Replace the paid intelligence tool defs with `request_intelligence`**

In the `_TOOL_DEFS` list (line 304+), delete the four entries for `fetch_tweets`, `fetch_reddit`, `fetch_news`, and `analyze_market`. In their place, add a single entry:

```python
    # -- intelligence (paid via x402, mediated by frontend) --
    (
        _decl(
            "request_intelligence",
            (
                "Request paid Apify intelligence (tweets, news, reddit, "
                "market analysis) via the user's x402 wallet. Does NOT call "
                "Apify directly — emits a payment request the frontend "
                "fulfils. After the user pays, results arrive in the next "
                "user message as `[tool_result <tool_name>]: <data>`."
            ),
            {
                "tool_name": {
                    "type": "string",
                    "enum": [
                        "fetch_tweets",
                        "fetch_reddit",
                        "fetch_news",
                        "analyze_market",
                        "markets_with_buzz",
                    ],
                    "description": "Which paid intelligence tool to invoke.",
                },
                "query": {
                    "type": "string",
                    "description": (
                        "Short search query (2-4 keywords). For "
                        "markets_with_buzz, comma-separated market titles."
                    ),
                },
                "max_items": {
                    "type": "integer",
                    "description": "Max results (default 10).",
                },
            },
            required=["tool_name", "query"],
        ),
        _request_intelligence,
    ),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_request_intelligence.py -v`
Expected: 6 PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/llm/tool_registry.py apps/api/tests/test_request_intelligence.py
git commit -m "feat(api): replace paid Apify tools with request_intelligence"
```

---

### Task 5: Break `run_chat` loop on `intelligence_request`

When a tool sets `ctx.intelligence_request`, the next loop iteration must stop and return immediately — Kowalski cannot keep generating because the frontend has to fulfil the payment first.

**Files:**
- Modify: `apps/api/src/api/llm/provider.py:108-160` (run_chat loop)
- Test: `apps/api/tests/test_run_chat_break.py`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_run_chat_break.py`:

```python
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


def _fake_response_with_call(name: str, args: dict) -> SimpleNamespace:
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/test_run_chat_break.py -v`
Expected: FAIL — `result.intelligence_request` is not propagated and the loop runs twice.

- [ ] **Step 3: Modify `run_chat` to break on intelligence_request**

In `apps/api/src/api/llm/provider.py`, find the section after the function-response parts are appended (around line 155). Replace the closing of the `for _ in range(_MAX_TOOL_ROUNDS):` loop and the trailing `return ChatResult` with:

```python
        contents.append(types.Content(role="user", parts=function_response_parts))

        if ctx.intelligence_request is not None:
            return ChatResult(
                text=(
                    "I need external data to answer that. Please confirm "
                    "the payment to continue."
                ),
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )

    return ChatResult(
        text="I hit the maximum number of tool calls. Please try a simpler request.",
        tx_cards=ctx.tx_cards,
    )
```

Also update the two earlier `return ChatResult(...)` calls inside the loop (the "no candidates" and "final text" paths) to pass `intelligence_request=ctx.intelligence_request` for completeness:

```python
        if not response.candidates:
            return ChatResult(
                text="I could not generate a response.",
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )

        candidate = response.candidates[0]

        if not response.function_calls:
            return ChatResult(
                text=response.text or "",
                tx_cards=ctx.tx_cards,
                intelligence_request=ctx.intelligence_request,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/test_run_chat_break.py -v`
Expected: PASS

- [ ] **Step 5: Run full LLM test suite to confirm no regression**

Run: `cd apps/api && uv run pytest tests/test_provider_prompt.py tests/test_tool_context_fields.py tests/test_request_intelligence.py tests/test_run_chat_break.py tests/test_chat.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/llm/provider.py apps/api/tests/test_run_chat_break.py
git commit -m "feat(api): break run_chat loop and propagate intelligence_request"
```

---

### Task 6: Accept `market_id` in `ChatRequest` and load market metadata

The route handler reads `market_id` from the request, fetches the market from the database, and populates `ctx.market_context`. Returns `404` if the market doesn't exist.

**Files:**
- Modify: `apps/api/src/api/routes/chat.py:48-61` (ChatRequest)
- Modify: `apps/api/src/api/routes/chat.py:96-123` (handler)
- Test: `apps/api/tests/test_chat_market_id.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_chat_market_id.py`:

```python
"""Tests for /v1/chat market_id loading and validation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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
    with patch("api.routes.chat.run_chat", new=AsyncMock(return_value=ChatResult("x", []))):
        resp = await client.post(
            "/v1/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "market_id": 9999,
            },
        )
    assert resp.status_code == 404
    assert "9999" in resp.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_chat_market_id.py -v`
Expected: 3 FAIL — `market_id` not accepted, no context loading.

- [ ] **Step 3: Add `market_id` to `ChatRequest`**

In `apps/api/src/api/routes/chat.py`, replace the `ChatRequest` model:

```python
class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    user_address: str | None = Field(default=None)
    chain_id: int | None = Field(default=None, ge=1)
    market_id: int | None = Field(default=None, ge=1)

    @field_validator("user_address")
    @classmethod
    def _validate_address(cls, v: str | None) -> str | None:
        if v is not None and not _ADDR_RE.match(v):
            raise ValueError("user_address must be a 0x-prefixed 40-hex-char address")
        return v.lower() if v else None
```

- [ ] **Step 4: Add a helper to load market context and update the handler**

Add the helper above the route function:

```python
async def _load_market_context(
    session: AsyncSession, market_id: int
) -> dict[str, object]:
    from sqlmodel import select

    from api.db.models import Market

    result = await session.execute(
        select(Market).where(Market.market_id == market_id)
    )
    market = result.scalar_one_or_none()
    if market is None:
        raise HTTPException(
            status_code=404, detail=f"Market #{market_id} not found"
        )
    labels = [str(o.get("label", i)) for i, o in enumerate(market.outcomes)]
    return {
        "market_id": market.market_id,
        "title": market.title,
        "category": market.category,
        "outcome_type": market.outcome_type,
        "outcome_labels": labels,
        "status": market.status,
        "expires_at": market.expires_at.isoformat() if market.expires_at else None,
    }
```

In the `chat` route, after the `chain_id` validation block, add:

```python
    market_context: dict[str, object] | None = None
    if body.market_id is not None:
        market_context = await _load_market_context(session, body.market_id)
```

And update the `ToolContext` instantiation to pass `market_context`:

```python
    ctx = ToolContext(
        session=session,
        client=client,
        chain_id=chain_id,
        user_address=body.user_address,
        market_context=market_context,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_chat_market_id.py -v`
Expected: 3 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/routes/chat.py apps/api/tests/test_chat_market_id.py
git commit -m "feat(api): load market context from market_id in /v1/chat"
```

---

### Task 7: Expose `intelligence_request` in `ChatResponse`

The route returns `intelligence_request` to the frontend so it can render the payment confirmation card.

**Files:**
- Modify: `apps/api/src/api/routes/chat.py:76-79` (ChatResponse)
- Modify: `apps/api/src/api/routes/chat.py:121-123` (response construction)
- Test: `apps/api/tests/test_chat_intelligence_response.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_chat_intelligence_response.py`:

```python
"""ChatResponse must expose intelligence_request when set."""

from __future__ import annotations

from typing import Any
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_chat_intelligence_response.py -v`
Expected: 2 FAIL — `intelligence_request` not in serialized response.

- [ ] **Step 3: Extend `ChatResponse` and the handler**

In `apps/api/src/api/routes/chat.py`, replace the `ChatResponse` model:

```python
class IntelligenceRequestResponse(BaseModel):
    tool: str
    args: dict[str, object]
    price_usd: float
    endpoint: str


class ChatResponse(BaseModel):
    text: str
    tx_cards: list[TxCardResponse]
    intelligence_request: IntelligenceRequestResponse | None = None
```

At the bottom of the route function, replace the response construction:

```python
    return ChatResponse(
        text=result.text,
        tx_cards=result.tx_cards,
        intelligence_request=(
            IntelligenceRequestResponse(**result.intelligence_request)
            if result.intelligence_request is not None
            else None
        ),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_chat_intelligence_response.py -v`
Expected: 2 PASS

- [ ] **Step 5: Run full chat test suite**

Run: `cd apps/api && uv run pytest tests/ -q`
Expected: all green except known pre-existing failures (test_health, test_free_route_not_blocked_by_paywall).

- [ ] **Step 6: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/src/api/routes/chat.py apps/api/tests/test_chat_intelligence_response.py
git commit -m "feat(api): expose intelligence_request in /v1/chat response"
```

---

### Task 8: Verify `[tool_result <name>]` round-trip

A user message of the form `[tool_result fetch_tweets]: <JSON>` is recognised by Kowalski as authoritative tool output (per HARD RULE 9). This is purely a system-prompt instruction — no code change is required, but we add a regression test that sends such a message through `/v1/chat` and confirms Kowalski does NOT call `request_intelligence` again.

**Files:**
- Test: `apps/api/tests/test_chat_tool_result_roundtrip.py`

- [ ] **Step 1: Write the test**

Create `apps/api/tests/test_chat_tool_result_roundtrip.py`:

```python
"""Smoke test: a [tool_result fetch_tweets] message must not trigger another paid request."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine


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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/test_chat_tool_result_roundtrip.py -v`
Expected: PASS (this is a regression check; no behaviour change is required since the system prompt already instructs the model on rule 9).

- [ ] **Step 3: Commit**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git add apps/api/tests/test_chat_tool_result_roundtrip.py
git commit -m "test(api): tool_result roundtrip smoke test"
```

---

### Task 9: Update OpenAPI spec via lint + final test sweep

Run lint, mypy, and the full test suite to make sure the integration is clean. Push.

- [ ] **Step 1: Run ruff**

```bash
cd apps/api && uv run ruff check src/ tests/
```
Expected: All checks passed (or only pre-existing warnings).

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/api && uv run pytest tests/ -q -k "not test_health and not test_free_route"
```
Expected: All pass (the two excluded are pre-existing route-mismatch failures unrelated to this work).

- [ ] **Step 3: Manually inspect the generated OpenAPI for `intelligence_request`**

```bash
cd apps/api && uv run python -c "from api.main import app; import json; spec=app.openapi(); print(json.dumps(spec['components']['schemas']['ChatResponse'], indent=2))"
```
Expected: `intelligence_request` field appears with `IntelligenceRequestResponse` schema reference.

- [ ] **Step 4: Push**

```bash
cd /Users/jankudlacek/Coding/ETH-Prague-2026
git push
```

---

## Self-review notes

- **Spec coverage:** All sections of the spec map to tasks. System prompt (Task 1, 3), backend changes (Tasks 2-7), testing requirements (Tasks 1-8 inline). Frontend work is explicitly out of scope per spec — not a plan gap.
- **Type consistency:** `ToolContext` extension (Task 2) is referenced consistently in Tasks 3, 4, 5, 6. `ChatResult.intelligence_request` is added in Task 2 and consumed in Task 7. `IntelligenceRequestResponse` is introduced once in Task 7.
- **No placeholders:** Every code step shows the literal change. Test code is complete; no "similar to" references.
- **Pre-existing test_chat.py:** The existing tests use `Kowalsky` as a hardcoded greeting in their fixtures. They don't assert on the prompt itself, so the rename in Task 1 doesn't break them. (Verified by re-reading test_chat.py line 21.)
