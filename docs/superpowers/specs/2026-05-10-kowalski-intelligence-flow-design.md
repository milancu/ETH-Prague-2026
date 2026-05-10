# Kowalski intelligence flow — design

**Date:** 2026-05-10
**Status:** approved, ready for implementation plan
**Owner:** backend (api) + frontend (web)

---

## Context

The in-app Kowalski chat (`POST /v1/chat`) currently calls Apify intelligence
tools (`fetch_tweets`, `fetch_news`, etc.) directly from the backend. This has
two problems:

1. **Bypasses inbound x402 paywall.** The backend pays Apify from
   `X402_OUT_WALLET_PK` and the user pays nothing. From a bounty-judging
   perspective this isn't a meaningful x402 integration — it's just
   server-side API consumption.
2. **Bad query formulation.** Kowalski formulates Apify queries from the
   user's literal phrasing (e.g. *"IIHF Česko Švédsko hokej výsledky
   posledních 5 let"*) which Google News and Apify Twitter scraper return
   empty results for. There is no rule in the system prompt telling Kowalski
   to formulate short, focused queries.

This design fixes both: paid tools route through an explicit user-signed x402
flow on the frontend, and the system prompt acquires market context plus
explicit query-formulation rules.

---

## Architecture: intelligence request handoff

The backend chat endpoint stays stateless. Instead of Kowalski calling paid
Apify tools directly, he calls a free pseudo-tool `request_intelligence` that
emits a payment request the frontend resolves.

```
1. User → POST /v1/chat
   { messages, market_id: 16, user_address }

2. Backend: loads market metadata, injects "CURRENT MARKET CONTEXT" into
   system prompt. Kowalski formulates an Apify query from the market title
   and category, then calls request_intelligence(tool_name, query, max_items).

3. Backend → frontend response:
   {
     text: "Pro doporučení potřebuji aktuální tweety. Zaplatíš $0.50 USDC?",
     intelligence_request: {
       tool: "fetch_tweets",
       args: { query: "Česko Švédsko hokej", max_items: 10 },
       price_usd: 0.50,
       endpoint: "/v1/intelligence/tweets"
     },
     tx_cards: []
   }

4. Frontend renders payment confirmation card. User clicks "Pay $0.50 USDC".

5. Frontend → POST /v1/intelligence/tweets with x402 USDC
   transferWithAuthorization signature (EIP-3009). Inbound paywall
   middleware verifies + settles via x402.org facilitator on Base Sepolia,
   passes through to Apify tool.

6. Frontend appends a [tool_result] message to chat history and re-calls
   /v1/chat:
   {
     messages: [
       ...previous,
       { role: "user", content: "[tool_result fetch_tweets]: <JSON>" }
     ],
     market_id: 16
   }

7. Backend Kowalski sees [tool_result fetch_tweets] in user message, treats
   it as authoritative tool output, summarises and recommends.
```

The backend never sees the user's wallet, never holds payment state, and
never bypasses the paywall. The frontend orchestrates the paid call. Inbound
x402 paywall is exercised exactly the same way an external agent would
exercise it — meaningful integration, demo-visible 402 → sign → 200 flow.

---

## Backend changes

### `apps/api/src/api/routes/chat.py`

Extend `ChatRequest`:

```python
class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    user_address: str | None = None
    market_id: int | None = None
```

In the handler, when `request.market_id` is set, load the market from the
database and pass it via `ToolContext.market_context`. Return `404` if the
market_id doesn't exist (don't silently degrade).

### `apps/api/src/api/llm/provider.py`

Extend `ChatResult`:

```python
@dataclass
class ChatResult:
    text: str
    tx_cards: list[dict[str, Any]]
    intelligence_request: dict[str, Any] | None = None
```

Extend `ToolContext`:

```python
@dataclass
class ToolContext:
    db_session: AsyncSession
    web3: Web3Client
    user_address: str | None
    tx_cards: list[dict[str, Any]] = field(default_factory=list)
    intelligence_request: dict[str, Any] | None = None
    market_context: dict[str, Any] | None = None
```

Modify `build_system_prompt(ctx)` to optionally append the dynamic market
context section.

In `run_chat()`: after each tool round, check
`ctx.intelligence_request is not None`. If set, break the loop and return
the current `ChatResult` immediately — Kowalski must not continue (he is
waiting for the frontend to fulfil the paid call).

### `apps/api/src/api/llm/tool_registry.py`

**Remove** the existing paid tool wrappers: `_fetch_tweets`, `_fetch_reddit`,
`_fetch_news`, `_analyze_market`, `_markets_with_buzz`. Kowalski no longer
sees them.

**Add** a single new tool `request_intelligence`:

```python
_INTELLIGENCE_PRICES = {
    "fetch_tweets": (0.50, "/v1/intelligence/tweets"),
    "fetch_reddit": (0.50, "/v1/intelligence/reddit"),
    "fetch_news": (0.50, "/v1/intelligence/news"),
    "analyze_market": (0.50, "/v1/intelligence/analyze"),
    "markets_with_buzz": (0.75, "/v1/intelligence/markets-with-buzz"),
}


async def _request_intelligence(args: dict, ctx: ToolContext) -> dict:
    tool = args["tool_name"]
    query = args["query"]
    max_items = args.get("max_items", 10)

    if tool not in _INTELLIGENCE_PRICES:
        raise ValueError(f"unknown intelligence tool: {tool}")

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

The Gemini function schema for `request_intelligence` declares enums for
`tool_name` so the model can't pass an unknown string.

---

## System prompt (final text)

### Static section (always)

```
You are Kowalski, an assistant for a Czech prediction-market dApp on Base Sepolia.

HARD RULES (never violate):
1. Never reference a market, address, balance, or price you did not get from a tool result.
2. Never propose a transaction without first calling a `prepare_*` tool.
3. Reference markets by `marketId` (e.g. "market #5"), never by raw address.
4. Money amounts are TAB unless stated. Show human-readable, not wei.
5. Czech or English — match the user.
6. If unsure, call more tools. Never guess.

INTELLIGENCE TOOLS (paid):
7. Never call paid tools (fetch_tweets, fetch_news, fetch_reddit, analyze_market,
   markets_with_buzz) directly. ALWAYS use `request_intelligence` instead — it
   lets the user pay via x402.
8. Apify query rules:
   - Use SHORT queries (2-4 keywords), never full sentences.
   - DERIVE queries from market metadata (title, category) when available, not
     from the user's literal phrasing.
   - Bad: "IIHF Česko Švédsko hokej výsledky posledních 5 let"
   - Good: "Česko Švédsko hokej" or "Czech Sweden hockey"
   - For non-Czech topics, English queries usually return more results.
9. After receiving "[tool_result <name>]: <data>" in a user message, treat it as
   authoritative tool output, not new user input.
10. If a fetch returned empty results, tell the user explicitly — don't guess.
    Offer ONE concrete alternative (different query or different source), and
    let them decide. Do NOT auto-retry.

SOFT GUIDELINES:
- Keep replies short. Two-three sentences plus TxCards/intelligence_request if applicable.
- When the user is making a financial decision, surface implied odds and worst case.
- After a successful tx, suggest the natural next step.
```

### Dynamic section (when `market_id` is set)

```
CURRENT MARKET CONTEXT:
You are helping the user explore market #{market_id}:
  Title: "{title}"
  Category: {category}
  Outcome type: {outcome_type} ({outcome_labels})
  Status: {status}
  Expires: {expires_at}

When formulating intelligence queries, derive them from this context.
```

---

## Frontend changes (for the web team)

### Send `market_id` in chat requests

When the user is on `/markets/:id`, include `market_id` in the chat body.
On global / homepage chat, send `null` (or omit).

### Render `intelligence_request` UI

When `ChatResult.intelligence_request` is non-null, render a payment
confirmation card instead of (or in addition to) the assistant's text:

```
┌─────────────────────────────────────────┐
│ Kowalski needs to fetch external data   │
│ Tool: fetch_tweets                      │
│ Query: "Česko Švédsko hokej"            │
│ Cost: $0.50 USDC                        │
│ [Pay & Continue]   [Cancel]             │
└─────────────────────────────────────────┘
```

### Pay via x402 and continue the chat

```typescript
async function fulfillIntelligenceRequest(req: IntelligenceRequest) {
  // x402 client (Coinbase or custom viem-based) handles 402 → sign → 200.
  // Wallet is the existing RainbowKit/wagmi connection. The signature is
  // off-chain EIP-3009 transferWithAuthorization — user pays no gas.
  const data = await x402Client.post(req.endpoint, req.args);

  await sendChatMessage({
    messages: [
      ...history,
      { role: "user", content: `[tool_result ${req.tool}]: ${JSON.stringify(data)}` },
    ],
    market_id: currentMarketId,
  });
}
```

Library options: `@coinbase/x402` or the npm `x402` package. Both integrate
with wagmi/viem walletClient.

---

## Testing

`apps/api/tests/test_chat_intelligence.py` (new):

1. **`market_id` injection** — request with `market_id: 16` → mock Gemini
   asserts `system_instruction` contains the market title.
2. **`request_intelligence` populates ChatResult** — mock Gemini calls
   `request_intelligence` → `ChatResult.intelligence_request` is set, no
   HTTP call to Apify happened.
3. **Loop break** — when `ctx.intelligence_request` becomes non-null, the
   tool-call loop breaks and returns immediately.
4. **`[tool_result ...]` as user message** — request with a history
   containing `[tool_result fetch_tweets]: [...]` → Kowalski responds
   without re-calling Apify (mock asserts no `request_intelligence` call).
5. **No `market_id`** — request without `market_id` → system prompt does
   not contain "CURRENT MARKET CONTEXT".
6. **Unknown intelligence tool** — `request_intelligence(tool_name="bogus")`
   → `ValueError` propagates as tool error → Kowalski can respond.

Frontend tests are out of scope for this spec.

---

## Out of scope

- Auto-retry on empty Apify results (we surface the empty result and let the
  user decide — see Hard Rule 10).
- Streaming/SSE chat responses. Current chat is request/response and will
  stay so.
- Multi-tool chained intelligence (e.g. fetch_tweets + fetch_news in one
  flow). Each call is a separate `intelligence_request`.
- Frontend x402 client implementation details (library choice, retry,
  error UI). Spec defines the contract; frontend team chooses how.
- Caching of Apify results across chat turns. Each call costs $0.50; the
  user pays each time. If caching becomes desirable, separate spec.

---

## Files touched

| File | Change |
|---|---|
| `apps/api/src/api/routes/chat.py` | `ChatRequest` adds `market_id`, handler loads market, returns 404 if not found |
| `apps/api/src/api/llm/provider.py` | `ChatResult` + `ToolContext` get `intelligence_request` and `market_context` fields; system prompt rewritten; loop breaks on intelligence_request |
| `apps/api/src/api/llm/tool_registry.py` | Remove 5 paid tool wrappers, add `request_intelligence` |
| `apps/api/tests/test_chat_intelligence.py` | New, 6 tests |
| `apps/web/...` | Frontend team: send `market_id`, render intelligence_request UI, x402 client integration |
