# docs/agents/ai_layer.md — Agent-agnostic backend infrastructure

This document is the **source of truth** for how the Czech prediction-market dApp exposes itself to AI agents. Read it before touching anything in `apps/api/src/api/llm/`, `apps/api/src/api/routes/intelligence/`, or any of the integration guides under `docs/integrations/`.

Read first: [`docs/constitution.md`](../constitution.md), [`docs/plan.md`](../plan.md), [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md).

---

## 1. North star

**We build standards-compliant backend infrastructure. The AI agent is the user's choice, not ours.**

The user picks how they interact with the protocol — OpenClaw, Claude Code, Cursor, ChatGPT Custom GPT, an autonomous Python bot, or `curl` from a shell. Our job is to expose:

1. A **REST API** documented with OpenAPI 3.1 — any HTTP client can consume it.
2. An **MCP server** wrapping the same tool surface — native MCP clients connect directly.
3. **x402 paywall** on premium tools — any client with an Ethereum wallet can pay autonomously.
4. **Integration guides** (`docs/integrations/*.md`) — short recipes per platform, not platform-specific code.

We do **not** build:
- Platform-specific helpers (no OpenClaw-only Python, no Claude-only skills).
- A built-in LLM in the user-facing critical path. (An optional in-app chat may exist; see §11.)
- Wallet management on the backend. Signing is the agent's environment's job.

---

## 2. Architecture

```
                ┌──────────────────────────────────┐
                │   AGENT-AGNOSTIC BACKEND         │
                │    (apps/api, FastAPI)           │
                │                                  │
                │   • REST API (OpenAPI 3.1)       │
                │   • MCP server (tier 2)          │
                │   • x402 paywall (premium)       │
                │   • SQLite + on-chain reads      │
                └────────────────┬─────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
       OpenClaw             Claude Code          ChatGPT GPT
       (SKILL.md)         (skill + MCP)         (Actions JSON)
            │                    │                    │
            ▼                    ▼                    ▼
       Telegram bot           Cursor IDE          Python bot
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                          User's wallet
                  (cast / viem / web3.py / ethers)
                                 │
                                 ▼
                     Base mainnet (USDC for x402)
                     Base Sepolia (TAB, markets)

                            (separately)
                Backend → x402 → api.apify.com
                   (we pay for Twitter / Reddit / News scrapes)
```

The same `apps/api` process serves all paths. There is one tool implementation; REST and MCP are two adapters over it.

---

## 3. The three layers of x402

x402 (HTTP `402 Payment Required`) is the centerpiece. We use it in **three** distinct flows:

### 3.1 Outbound (we pay Apify)

Premium tools internally fetch real-time web data via Apify. Our backend service wallet holds USDC on Base mainnet and pays per-call.

- File: `apps/api/src/api/lib/apify_x402.py`
- Library: **[`x402` PyPI package](https://pypi.org/project/x402/)** v2.9+ from x402 Foundation. `pip install x402[httpx,evm]`.
- Auth: backend service wallet PK from env (`X402_OUT_WALLET_PK`).
- Network: Base mainnet (`eip155:8453`), USDC contract.
- Min spend: $1 USDC per Actor invocation (Apify constraint, not ours).
- Implementation sketch:

  ```python
  from x402 import x402Client
  from x402.mechanisms.evm.exact import ExactEvmScheme

  client = x402Client()
  client.register("eip155:*", ExactEvmScheme(signer=our_wallet_signer))
  # When Apify returns 402, x402Client handles sign + retry transparently.
  ```

- Flow handled internally by the library:
  1. `POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items` with x402 protocol header.
  2. Receive `402 PAYMENT-REQUIRED` with payment terms.
  3. Library signs EIP-712 `transferWithAuthorization` for USDC.
  4. Library resends with `PAYMENT-SIGNATURE` header.
  5. Receive `200` + dataset items.

### 3.2 Inbound (agents pay us)

Premium endpoints (`/v1/intelligence/*`) require x402 payment from the calling agent. We are the server; the agent is the client.

- File: `apps/api/src/api/lib/x402_server.py`
- Library: **`x402[fastapi,evm]`** — same official package as outbound, server-side primitives.
- Auth: receiving wallet address from env (`X402_IN_WALLET_ADDRESS`).
- **Network: Base Sepolia (`eip155:84532`).** The public x402 facilitator at `https://x402.org/facilitator` currently supports only testnet — Base mainnet support is on the roadmap. Inbound is therefore testnet for the hackathon. This is asymmetric with outbound (which is Base mainnet, since Apify mandates it). The same backend wallet keypair works on both chains — it just receives Sepolia USDC and sends Mainnet USDC, which are separate ERC-20 contracts.
- USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Verification + settlement: outsourced to the facilitator via `HTTPFacilitatorClient`. We do not submit settlement transactions ourselves.
- Pricing per endpoint: see §4.2.
- Implementation sketch:

  ```python
  from x402 import x402ResourceServer, ResourceConfig
  from x402.http import HTTPFacilitatorClient
  from x402.mechanisms.evm.exact import ExactEvmServerScheme

  facilitator = HTTPFacilitatorClient(url="https://x402.org/facilitator")
  server = x402ResourceServer(facilitator)
  server.register("eip155:*", ExactEvmServerScheme())

  config = ResourceConfig(
      scheme="exact",
      network="eip155:8453",       # Base mainnet
      pay_to=os.environ["X402_IN_WALLET_ADDRESS"],
      price="$0.50",
  )
  requirements = server.build_payment_requirements(config)

  # In FastAPI dependency / middleware:
  #   1. If incoming request lacks PAYMENT-SIGNATURE → return 402 with `requirements`.
  #   2. Otherwise, await server.verify_payment(payload, requirements[0]).
  #   3. On success, run the tool handler.
  ```

- Flow (handled by middleware, transparent to route handlers):
  1. Agent calls our endpoint without `PAYMENT-SIGNATURE`.
  2. We respond `402 PAYMENT-REQUIRED` with `requirements` JSON.
  3. Agent signs EIP-712 USDC `transferWithAuthorization`.
  4. Agent retries with `PAYMENT-SIGNATURE`.
  5. Facilitator verifies signature off-chain, submits settlement on-chain, reports back. We execute the tool and return `200`.

### 3.3 Chained (agent → us → Apify)

The full revenue flow is two x402 payments stacked in one request:

```
Agent (e.g. Telegram bot) ──$0.50 USDC──▶ Us
                                         │
                                         │ $0.05 USDC (out of received funds)
                                         ▼
                                       Apify (Twitter scrape)
```

The margin between inbound charge and outbound cost is the protocol's B2A revenue stream. This is the headline narrative for both the **Apify bounty** (creative integration: agent selling to other agents) and the **Umia bounty** (path to revenue).

---

## 4. REST API surface

All endpoints versioned under `/api/v1/`. OpenAPI auto-generated from FastAPI Pydantic models, served at `/api/openapi.json` and rendered at `/api/docs`.

### 4.1 Free endpoints (read + calldata builders)

| Method + Path | Purpose | Returns |
|---|---|---|
| `GET /markets` | List active markets, paginated | `[{ marketId, name, category, status, expiresAt, outcomeLabels }]` |
| `GET /markets/{id}` | Single market detail | full market struct + best bid/ask per outcome |
| `GET /markets/{id}/orderbook` | CLOB orders for a market | sorted bids/asks, filtered for live |
| `GET /markets/{id}/positions/{address}` | User positions in a market | `[{ slot, label, balance1155, balanceWrapped }]` |
| `GET /balance/{address}` | TAB balance | `{ balance, formatted }` |
| `POST /prepare/buy` | Build buy calldata | `TxCard` |
| `POST /prepare/sell` | Build sell maker order (signature, not tx) | `OrderCard` |
| `POST /prepare/create-market` | Build createMarket calldata | `TxCard` (with bond approval as precondition) |
| `POST /prepare/claim` | Build claimWinnings calldata | `TxCard` |
| `POST /prepare/merge` | Build mergeFrom calldata | `TxCard` |
| `POST /prepare/cancel-order` | Build cancel calldata | `TxCard` |

`TxCard` shape (returned by all `prepare/*`):

```jsonc
{
  "to": "0x...",
  "data": "0x...",
  "value": "0",
  "chainId": 84532,                      // Base Sepolia
  "summary": "Bet 10 TAB on YES in market #5",
  "requires": [                          // preceding txs (e.g. approves)
    { "to": "0x...", "data": "0x...", "summary": "Approve PMv2 to spend 100 TAB" }
  ]
}
```

The agent's environment is responsible for signing and broadcasting. We never see a private key.

### 4.2 Paywalled endpoints (x402, USDC on Base mainnet)

| Method + Path | Cost | Internal call | Returns |
|---|---|---|---|
| `POST /v1/intelligence/tweets` | $0.50 | `apidojo/twitter-scraper-lite` | `{ tweets: [{id, author, text, ts, url, engagement}], cost_usdc, source }` |
| `POST /v1/intelligence/reddit` | $0.50 | `webdatalabs/reddit-scraper-pro` | analogous |
| `POST /v1/intelligence/news` | $0.50 | `automation-lab/google-news-scraper` | analogous |
| `POST /v1/intelligence/analyze` | $0.50 | one of the above + summarisation | `{ thesis, sentiment, sources, suggested_close_date }` |
| `POST /v1/intelligence/markets-with-buzz` | $0.75 | search markets + Twitter | `[{ marketId, name, tweet_count_24h, top_tweet }]` |
| `POST /v1/intelligence/correlate-with-news` | $0.75 | price history + news at spike timestamps | `[{ spike_at, magnitude, candidate_news: [...] }]` |

Pricing is conservative; tunable via env. Margin over Apify's per-call cost is the revenue layer.

### 4.3 OpenAPI doc

Auto-generated at startup. Every public endpoint must:

- Have a Pydantic request and response model.
- Have a `summary` and `description` set on the route decorator.
- Be tagged (`free`, `paywall:x402`, etc.) for filtering.
- Document the `402` response on paywalled routes.

---

## 5. MCP server (Tier 2)

A second adapter over the same tool implementation, for agents that natively speak MCP (Claude Code, Cursor, Continue, custom MCP clients).

- Endpoint: `https://api.our-domain/mcp` (production) or `http://localhost:8000/mcp` (dev).
- Transport: **Streamable HTTP** (modern MCP standard, single POST endpoint, JSON-RPC over HTTP with optional SSE responses). SSE-only transport is not exposed.
- Implementation: `apps/api/src/api/mcp/server.py`, using the `mcp` Python package from PyPI.
- Mount: FastMCP's Starlette ASGI sub-app is mounted at `/mcp` under the same `apps/api` FastAPI process. Lifespan: the FastAPI app's `lifespan` context manager wraps `mcp_server.session_manager.run()` so the streamable-HTTP task group runs for the lifetime of the API.
- Tools advertised: same surface as REST §4 — list_markets, get_market, get_market_orderbook, get_user_positions, get_tab_balance, prepare_buy/sell/create_market/claim/merge/cancel_order, fetch_tweets/reddit/news, analyze_market, markets_with_buzz. Handlers reuse `llm/tools/*` and `lib/web3_client` directly; the MCP server is a thin adapter.
- x402 metadata is exposed in tool descriptors via the MCP `_meta` field — `{"x402_price_usd": 0.50, "x402_network": "eip155:84532", "x402_pay_to": "0x..."}` — so MCP clients can show pricing before invocation.

### x402 enforcement on MCP

All MCP tool calls arrive as `POST /mcp` with the tool name in the JSON-RPC body. The path-based REST middleware (`payment_middleware`) cannot differentiate per-tool because the path is always the same. We therefore use a dedicated middleware (`apps/api/src/api/lib/x402_mcp.py`) that:

1. Buffers the incoming request body (Starlette caches `request._body` after first read; the mounted FastMCP sub-app reads from the same cached buffer).
2. Parses the JSON-RPC body to identify `method == "tools/call"` and the tool name.
3. If the tool is paywalled and no `X-Payment` header is present, returns HTTP 402 with payment requirements JSON — the same x402 challenge issued by the REST middleware.
4. If a valid `X-Payment` header is present, verifies via `x402ResourceServer.verify_payment` (shared singleton with the REST paywall — one facilitator handshake), passes through to FastMCP, then settles.

Choice rationale: the HTTP middleware approach keeps the x402 contract identical between REST and MCP (real HTTP 402 responses, real challenge/sign/verify dance) and lets MCP clients with x402 client support (e.g. via `x402` PyPI client) sign and retry transparently. In-handler enforcement was rejected because MCP tool errors are JSON-RPC-level, not HTTP-level, and would not trigger automatic retry in x402-aware clients.

This is **Tier 2** — not blocking the MVP. Skip if time short, ship REST + integration guides first.

---

## 6. Tx signing — strictly client-side

Our backend never holds a key that can move user funds. Every `prepare/*` returns a `TxCard` with `to` / `data` / `value` / `chainId`. The agent signs in its own environment.

Per agent platform, signing typically means one of:

- `cast send --private-key $PK --rpc-url $RPC <to> <data>` (foundry, the most universal).
- `viem.walletClient.sendTransaction({ to, data, value })` (TS bots).
- `web3.eth.account.sign_transaction(...)` then `eth.send_raw_transaction(...)` (Python bots).
- A user click in MetaMask if the agent surfaces the tx via WalletConnect.

The agent decides; we just hand over calldata. Same applies to EIP-712 maker orders for the CLOB — we return the typed-data structure, the agent signs locally, posts back to `POST /api/v1/orders`.

---

## 7. Distribution: integration guides, not platform code

For each major platform, we ship **one short markdown recipe** under `docs/integrations/`. The guide explains:

1. How to install / register our service in the agent (e.g. drop a SKILL.md in `~/.openclaw/skills/`, add an MCP server to `~/.config/claude/mcp.json`, paste an OpenAPI URL into a Custom GPT's Actions tab).
2. Required env vars (`BASE_RPC_URL`, `USER_PRIVATE_KEY`, `USDC_ADDRESS`).
3. Example prompts ("Vsadit 10 TAB na ANO v marketu #5", "Analyzuj market #3").
4. Troubleshooting (gas not enough, USDC missing, signature rejected).

| Guide | Target platform | Status |
|---|---|---|
| `docs/integrations/openclaw.md` | OpenClaw (`SKILL.md` format) | TODO |
| `docs/integrations/claude-code.md` | Claude Code (skill + MCP) | TODO |
| `docs/integrations/openai-gpt.md` | ChatGPT Custom GPT (Actions) | TODO |
| `docs/integrations/python-bot.md` | Autonomous Python bot | TODO |
| `docs/integrations/raw-http.md` | Plain `curl` walkthrough | TODO |

We write these only after Tier 1+2 backend is green. Each guide is ~100 lines.

---

## 8. File map

```
apps/api/src/api/
├── routes/
│   ├── markets.py             # §4.1 free endpoints
│   ├── prepare.py             # §4.1 prepare/*
│   ├── orders.py              # CLOB read + post signed orders
│   └── intelligence.py        # §4.2 paywalled endpoints
├── llm/
│   └── tools/
│       ├── chain.py           # web3 readers, shared by routes/markets.py
│       ├── orderbook.py       # CLOB readers, shared by routes/orders.py
│       ├── prepare.py         # calldata builders, shared by routes/prepare.py
│       └── apify.py           # uses lib/apify_x402.py to fetch tweets/news/reddit
├── lib/
│   ├── apify_x402.py          # §3.1 outbound x402 client
│   ├── x402_server.py         # §3.2 inbound x402 (verify + settle)
│   ├── web3_client.py         # singleton w3 + contract bindings
│   └── csv_reader.py          # legacy CLOB CSV reader (until DB migration)
├── mcp/
│   └── server.py              # §5 MCP wrapper, optional
└── main.py                    # app factory, includes routers
```

No frontend dependency. The optional in-app chat (§11) lives elsewhere.

---

## 9. Implementation phases

Ship in this order. Each phase is shippable on its own.

### Phase 1 — free reads + calldata (~1 day)

- `routes/markets.py`, `routes/prepare.py`, `routes/orders.py`.
- `tools/chain.py`, `tools/prepare.py`, `tools/orderbook.py` per the original Kowalsky tool spec (preserved as Appendix A).
- OpenAPI doc auto-publishes.
- Definition of done: a `curl` user can list markets, fetch calldata, sign with `cast`, and have the tx land.

### Phase 2 — outbound x402 + paywalled endpoints (no paywall yet) (~1 day)

- `lib/apify_x402.py`.
- `tools/apify.py` (`fetch_tweets`, `fetch_news`, `fetch_reddit`, `analyze_market`, `markets_with_buzz`, `correlate_with_news`).
- `routes/intelligence.py` exposing them — **with paywall middleware in passthrough mode** (returns 402 docs but does not require signature yet, for testing).
- DoD: backend can call Apify with our wallet PK, return summarised results.

### Phase 3 — inbound x402 paywall (~half day, low risk thanks to `x402` package)

- `lib/x402_server.py`: thin FastAPI dependency wrapping `x402ResourceServer` + `HTTPFacilitatorClient`. Off-chain verification + on-chain settlement are outsourced to the public facilitator at `x402.org/facilitator` — we never submit settlement txs ourselves.
- Paywall middleware enforces 402 challenge → signature → facilitator-settle → execute.
- DoD: a test client (Python script using the same `x402` package on the client side) can pay $0.50 and receive the result. Two-x402-chain demo works.

### Phase 4 — MCP server (~half day, optional)

- `mcp/server.py` registers same tools as MCP, advertises x402 cost metadata.
- DoD: `mcp inspect` against our endpoint lists tools with prices.

### Phase 5 — integration guides (~half day, ~1h per guide)

- Write `docs/integrations/*.md` for OpenClaw, Claude Code, ChatGPT, Python, raw HTTP.
- DoD: a junior dev can install our protocol into one agent in under 10 minutes following the guide.

---

## 10. Apify Actors (reference, swappable)

We've selected three actors as the initial set. They are configurable in `apps/api/.env` and may be swapped at any time without touching call sites.

| Actor slug | Use | Pricing | Status |
|---|---|---|---|
| `apidojo/twitter-scraper-lite` | Twitter / X content + sentiment | Pay Per Event | confirmed PPE-compatible with x402 |
| `webdatalabs/reddit-scraper-pro` | Reddit posts + comments | claimed PPE | **pending PPE confirmation** (Jakub Kopecký, Apify mentor) |
| `automation-lab/google-news-scraper` | Czech + global news headlines | claimed PPE | **pending PPE confirmation** |

Apify's x402 integration only supports actors with the **Pay Per Event** pricing model — Pay Per Result, Pay Per Usage, Standby actors are rejected. Confirm with Jakub on day 1 of the hackathon.

Configuration:

```bash
# apps/api/.env
APIFY_ACTOR_TWITTER=apidojo/twitter-scraper-lite
APIFY_ACTOR_REDDIT=webdatalabs/reddit-scraper-pro
APIFY_ACTOR_NEWS=automation-lab/google-news-scraper
APIFY_BASE_URL=https://api.apify.com
```

Adding a fourth scraper is one env line + one wrapper function in `tools/apify.py`.

---

## 11. Optional in-app chat (frontend's call)

The frontend may decide to ship a chat widget at `apps/web/components/Chat.tsx` that proxies through `POST /api/v1/chat`. This endpoint:

- Wraps a Gemini (or any LLM) function-calling loop.
- Internally calls the same tools as `routes/*` and `mcp/server.py`.
- Streams tool-use events to the frontend (e.g. `{ type: "x402_402", amount: 1.0 }`, `{ type: "tool_result", ... }`) for rich UI bubbles.
- Returns `{ text, txCards: TxCard[] }` for the user to sign in their wallet.

This is **not on the critical path**. The backend works without it. If frontend builds it, infrastructure already exists; if not, no impact.

The original Kowalsky chat spec — system prompt, tool registry, system rules, demo journeys — is preserved verbatim in **Appendix A** below for whoever implements `/api/v1/chat`.

---

## 12. Wallets & funding

| Wallet | Network | Holds | Purpose | Funding |
|---|---|---|---|---|
| `X402_OUT_WALLET` | Base **mainnet** | USDC + ETH | pays Apify | $20 USDC + $5 ETH (real money) |
| `X402_IN_WALLET` | Base **Sepolia** | receives Sepolia USDC from agents | revenue observability + demo | $0 (only address needed) |
| Demo client wallet | Base **Sepolia** | Sepolia USDC + Sepolia ETH | simulates external agent paying us | from faucets, free |

**The same keypair** can serve as `X402_OUT_WALLET` and `X402_IN_WALLET` — EVM addresses are chain-agnostic. We just hold mainnet USDC for outbound and accept Sepolia USDC inbound on the same address.

Faucets for the demo client wallet:
- Sepolia ETH: <https://faucet.circle.com> or <https://www.alchemy.com/faucets/base-sepolia>
- Sepolia USDC: <https://faucet.circle.com> (Circle's testnet faucet, gives $10 USDC)

---

## 13. Open questions

1. ~~Server-side x402 Python lib~~ — **resolved.** Use the official **[`x402` PyPI package](https://pypi.org/project/x402/)** v2.9+ from x402 Foundation (MIT, FastAPI middleware, EVM exact scheme on Base 8453, public facilitator at `x402.org/facilitator` for verification + settlement). Drops Phase 3 from "highest risk" to "half-day chore". Alternative `openlibx402` is Solana-only, irrelevant for our Base mainnet target.
2. **PPE confirmation** for Reddit + News scrapers (Jakub Kopecký, Apify mentor on booth).
3. **Wallet funding logistics** — who, when, how (CEX → bridge to Base mainnet).
4. ~~Facilitator availability + cost~~ — **resolved.** Public facilitator at `x402.org/facilitator` works but supports only Base Sepolia (`eip155:84532`), not Base mainnet (`eip155:8453`). Inbound therefore runs on Sepolia for the hackathon (see §3.2 and §12). Mainnet inbound would require either a different facilitator or running our own; not on hackathon scope.

---

## 14. Bounty alignment quick-reference

| Bounty | What this architecture delivers |
|---|---|
| **Apify** | Outbound x402 to Apify Actors (§3.1) + chained inbound→outbound demo (§3.3). Visible 402 → sign → 200 across two payment hops. Hits all three Apify judging criteria. |
| **Umia (Best Agentic Venture)** | Agent-agnostic backend = product is consumed by N agents × M users (multi-tenant). x402 paywall = clear path to revenue. Three layers of agentic execution: end-user agents (any platform), backend operations agent (paying Apify), public agent-API (selling intelligence). |
| **ETHPrague Network Economy track** | Privacy-respecting, on-chain economic primitive (prediction markets) coordinated through standard protocols (HTTP, x402, MCP). |
| **ENS** (if we add it) | Subname registrar for markets is independent of this layer; `<slug>.kowalsky.eth` resolution can be exposed as a free read endpoint. |

---

## Appendix A — Optional Kowalsky in-app chat (preserved from prior spec)

If the frontend decides to ship the in-app chat (§11), the agent is called Kowalsky. The full spec for Kowalsky's tool surface, system prompt, user journeys, and order-book intelligence is preserved here verbatim from the previous version of this doc. None of it is required for the agent-agnostic backend to function — these tools are reused under the hood by `routes/*`, but the chat-specific framing only applies if `/api/v1/chat` is built.

### A.1 System prompt for Kowalsky

```
You are Kowalsky, an assistant for a Czech prediction-market dApp on Base Sepolia.

HARD RULES (never violate):
1. Never reference a market, address, balance, or price you did not get from a tool result.
2. Never propose a transaction without first calling a `prepare_*` tool. The frontend
   will reject any tx you describe without a TxCard.
3. Reference markets by `marketId` (e.g. "market #5"), never by raw address.
4. If the user asks to do something not currently possible (no liquidity, market expired,
   wrong network), say so clearly with the reason from the tool result.
5. Money amounts are TAB unless explicitly stated otherwise. Always show the human-readable
   amount, not wei.
6. You may use Czech or English to match the user.
7. If you are unsure, call more tools. Never guess.

SOFT GUIDELINES:
- Keep replies short. Two-three sentences plus a TxCard if applicable.
- When the user is making a financial decision, surface the implied odds and worst case.
- After a successful tx, suggest the natural next step.
```

### A.2 Demo journeys

- "Vsadit 10 TAB na ANO v Slavia trhu" → `search_markets` → `get_market` → `prepare_buy` → user signs.
- "Vytvoř trh: bude Bitcoin přes 200 000 USD k 31.12.?" → `prepare_create_market` with bond approve precondition.
- "Did I win on market #3?" → `get_market_status` → `get_user_positions` → `prepare_claim`.
- "Prodej 20 wYES na trhu #5 za 0.7 TAB každý" → `prepare_sell` returns EIP-712 order to sign + wrapper-approve precondition.
- "Vrátit 30 TAB z trhu #5 (mám full set)" → `prepare_merge`.
- "Zruš můj sell order #ykoe7h" → `prepare_cancel_order`.
- "Co všechno vlastním?" → `get_tab_balance` + `list_markets` + `get_user_positions` + `list_orders`, render as portfolio table.

### A.3 Order-book intelligence

CSV at `apps/contracts/packages/nextjs/data/orders.csv` is the source of truth for live makers until DB migration. Each row is **possibly stale** — verify on-chain (`TabClob.canceled[hash]`, `TabClob.filledMakerAmount[hash]`) before claiming a price exists.

Pricing convention:
- **sell** order = maker offers `wPosition` for `TAB`. Implied price = `takerAmount / makerAmount`.
- **buy** order = maker offers `TAB` for `wPosition`. Implied price = `makerAmount / takerAmount`.
- Best ask = lowest sell price; best bid = highest buy price; per `(marketId, slot)`.

When `prepare_buy` finds insufficient liquidity, fall back to `PMv2.splitAndWrap` and tell the user explicitly that the position is being minted, not bought.

---

*End of canonical spec. Implementation starts at §9 phase 1.*
