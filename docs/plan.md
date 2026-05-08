# Plan — how we build it

Technical architecture. Constraints from [`constitution.md`](./constitution.md) override anything here.

## High-level architecture

```
┌──────────────────────┐   HTTPS    ┌──────────────────────┐
│ Frontend (Vite/React)│ ─────────► │ Backend (FastAPI/Py) │
│  - wagmi/viem        │            │  - LLM proxy         │
│  - RainbowKit        │            │  - Indexer / read API│
│  - shadcn/ui         │            │  - Market metadata   │
└──────┬───────────────┘            └──────┬───────────────┘
       │                                   │
       │ JSON-RPC (viem)                   │ JSON-RPC (web3.py)
       ▼                                   ▼
┌────────────────────────────────────────────────────────────┐
│  Local Hardhat network (primary)  →  Base Sepolia (later)  │
│  - TABcoin (TAB, our own ERC-20)                           │
│  - ConditionalTokens (own Gnosis-CTF-compatible ERC-1155)  │
│  - PredictionMarketV2 (lifecycle + curation + bond)        │
│  - PositionWrapper(Factory) (ERC-1155 → ERC-20 wrappers)   │
│  - TabClob (EIP-712 ERC-20 limit order book)               │
└────────────────────────────────────────────────────────────┘
```

## Frontend (`apps/web`)

- **Vite + React 19 + TypeScript.**
- **Tailwind + shadcn/ui** for everything visual. No hand-written CSS.
- **wagmi v2 + viem + RainbowKit** for wallet, chain reads, and chain writes. `useReadContract`, `useWriteContract`, `useSimulateContract` before every write.
- Configured chains: **Hardhat local (chainId 31337)** as the primary dev target, **Base Sepolia** added when that deployment exists. Active chain is read from a `VITE_DEFAULT_CHAIN` env var so we can flip without code changes.
- AI chat is a client-side widget that talks to `apps/api` over HTTPS. The frontend never talks to the LLM provider directly.
- Speech-to-text: **Web Speech API** in the browser for MVP. Whisper via the backend is a stretch.
- The frontend **revalidates every AI-proposed transaction**: contract address must match a known address from the shared config, function selector must match an allow-listed function, amounts must be within sane bounds and approved by the user.

### Mode flags

- **Simple mode** (default): Yes/No buttons. Under the hood: takes a quote from the backend (best ask/bid on `TabClob` for the wrapped outcome ERC-20) and signs a `TabClob.fill` against an existing maker order. **Open design question:** maker liquidity. Options: (a) team runs a maker bot seeded with TAB, (b) factory auto-mints a full-set into TAB on market creation and posts opening orders, (c) accept that simple-mode is unusable until liquidity exists. Decide before `T2.4`.
- **Pro mode**: read-only `TabClob` order book + a minimal order entry form (sign EIP-712, post to backend mempool, taker fills on-chain). Full maker tooling is post-hackathon.
- **Odds display toggle**: global state, persisted to `localStorage`.

## Backend (`apps/api`)

- **Python 3.12 + FastAPI**, managed with `uv`. `uv run fastapi dev src/api/main.py --port 8000`.
- Validation: **Pydantic v2** on every request body, response, and LLM tool I/O. No untyped routes.
- Logging: structured logs via standard `logging` + `python-json-logger` (TBD in T3.1).
- Tests: **pytest** + **httpx** for route-level integration. Lint: **ruff**. Types: **mypy strict**.
- Chain reads: **web3.py** (TBD in T3.4). Read-only — the backend never holds a private key that can move user funds.
- Responsibilities:
  1. **LLM proxy.** Receives chat messages from the frontend, forwards to the LLM with a system prompt and a function-calling tool schema, returns structured JSON the frontend can render as Transaction Cards.
  2. **Read API for AI.** Indexed view of markets, prices, user positions, open orders on `TabClob`. The LLM calls these as tools. The LLM cannot efficiently read contract storage; it queries our cached, structured view.
  3. **Market metadata storage.** Titles, descriptions, resolution criteria, categories, curator status. The on-chain contract stores only the minimum (condition id, bond, creator, expiry). Rich text and tags live in our DB and are referenced by `marketId`.
  4. **Indexer.** A worker that subscribes to chain events (`PredictionMarketV2.MarketCreated`, `ConditionalTokens.PositionSplit` / `PayoutsReported`, `TabClob.Filled`, `WrapperCreated`) and writes them to the DB.
  5. **CLOB order relay (TBD).** Maker EIP-712 orders need a place to live before takers fill them. Options: store in our DB (centralized but simple), or have makers post to a shared off-chain pool. Decide before `T3.6`.
- Database: **TODO** — pick one before `T3.2`. Default lean: SQLite + SQLModel (zero infra). Postgres + SQLAlchemy 2.0 if we want a real DB. Either way, schema is checked in.
- Auth: **SIWE** (Sign-In With Ethereum) for write operations on metadata and order posting. Read endpoints are public. Use `siwe-py` or hand-roll EIP-4361 verification.

### LLM tool schema (function calling)

The LLM has tools like:

- `search_markets(query, category?)` — returns matching markets with current best bid/ask.
- `get_market(marketId)` — returns one market in detail (current `TabClob` book summary, recent fills, conditionId, outcome wrappers).
- `get_user_positions(address)` — returns the user's wrapped outcome ERC-20 balances + claimable amounts.
- `prepare_take(marketId, side, makerOrderId, amount)` — returns a Transaction Card payload for `TabClob.fill` against a specific maker order.
- `prepare_create_market(draft)` — returns a Transaction Card payload for `PredictionMarketV2.createMarket` (TAB approval + market creation in two steps).
- `prepare_claim(marketId)` — returns a Transaction Card payload for `ConditionalTokens.redeemPositions` once the market has reported payouts.

`prepare_*` tools do **not** execute anything. They produce structured payloads the frontend renders and that the user must sign.

### LLM provider

- TODO: OpenAI vs. Anthropic. Both support function calling. Decision before `T5.1`. Default assumption: Anthropic `claude-sonnet-4-6` if we have keys; OpenAI `gpt-4o` otherwise. Hide the SDK behind `src/api/llm/provider.py` so swapping is a one-file change.

## Smart contracts (`apps/contracts`)

`apps/contracts/` is a **Scaffold-ETH 2 monorepo** (Hardhat flavor): `packages/hardhat/` for Solidity + deploy + tests, `packages/nextjs/` as an SE-2 contract debug UI (separate from the production frontend in `apps/web/`).

- **Solidity ^0.8.24**, Hardhat + TypeScript, OpenZeppelin v5.
- Deploy helper: **`hardhat-deploy`** (snake_case scripts in `packages/hardhat/deploy/`, numbered `00…07`).
- Networks: `hardhat` (in-process, default for tests), `localhost` (`http://127.0.0.1:8545`), `baseSepolia` (env-gated).

### Contracts in scope

- **`TABcoin.sol`** — ERC-20 (`TAB`, 18 decimals), burnable. Hardcoded `AUTHORIZER` mints + grants per-address claim allowances (`CLAIM_AMOUNT` per allowance). Only collateral token in the system. No USDC.
- **`ConditionalTokens.sol`** — Lightweight Gnosis-CTF-compatible ERC-1155. Binary, multi, scalar, ordinal outcomes. No nested conditions.
- **`PredictionMarketV2.sol`** — Lifecycle + curation + bond layer over `ConditionalTokens`. Registered as the oracle for every market it creates; per-market `oracle` is the auth.
- **`PositionWrapper.sol`** + **`PositionWrapperFactory.sol`** — `Clones`-based ERC-1155 → ERC-20 wrappers per `(collateral, conditionId, indexSet)`. Outcome shares trade as ERC-20.
- **`TabClob.sol`** — Minimal EIP-712 ERC-20 limit order book. Off-chain signed orders, on-chain atomic fill via `fill`. `SignatureChecker` covers ECDSA EOAs + EIP-1271 smart wallets.
- **`YourContract.sol`** — SE-2 boilerplate, removable.

### Out of scope here

- AMM (`BinaryAMM`, FPMM). Not built; not needed if simple-mode goes through `TabClob` taker flow.
- UMA / external oracle. Resolution is per-market `oracle` (admin/curator) for the hackathon.
- Upgradable proxies. We redeploy on bugs.

## Shared (`packages/shared`)

- TypeScript types for markets, positions, transaction-card payloads.
- Contract ABIs (auto-generated from Hardhat artifacts via `apps/contracts/packages/hardhat/scripts/generateTsAbis.ts`).
- Address book per chain (`hardhat.json`, `baseSepolia.json`).
- Zod schemas for validating LLM output and AI-proposed transactions. **The Python backend has equivalent Pydantic models** for the same shapes; treat the Zod schemas as the canonical source and regenerate Pydantic from them (TBD: codegen vs. hand-mirror).

## Data flow examples

### Placing a bet via Kowalsky (simple mode)

1. User types message → frontend sends to `POST /api/chat`.
2. Backend forwards to LLM with tool schema. LLM calls `search_markets`, then `prepare_take` against the best ask.
3. Backend executes those tools (DB reads + `TabClob` read via `web3.py`) and returns the LLM's final message + structured `transactionCards[]`.
4. Frontend renders cards. User clicks **Approve & Sign**.
5. Frontend revalidates the card payload against the shared config, calls `useSimulateContract`, then `useWriteContract` against `TabClob.fill`. (TAB approval is a separate step if not already approved.)
6. Wallet signs. Tx confirms. Frontend invalidates wagmi cache. Position appears in portfolio (the user now holds the wrapped outcome ERC-20).

### Creating a market

1. User describes the market in `/create`.
2. Frontend sends to `POST /api/chat` with intent `create_market`.
3. LLM drafts title, description, resolution criteria, expiry. Backend returns a `prepare_create_market` Transaction Card.
4. User edits any field, sets bond amount, clicks **Create & Lock Bond**.
5. Frontend approves TAB, calls `PredictionMarketV2.createMarket`. Wallet signs.
6. Indexer picks up `MarketCreated` event and writes the market to DB with curator status `unverified`.
