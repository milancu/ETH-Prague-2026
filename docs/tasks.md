# Tasks

Broken-down, ordered work items. Each task should be a single PR. Branch name in `[brackets]`. Owner suggestion in `(parens)` — adjust as you go.

Phases run loosely in parallel across packages once Phase 0 is done.

> **Status note (2026-05-08):** Phase 0 and most of Phase 4 are already implemented. Phase 3 (backend) was kicked off in Python (FastAPI), not TypeScript. This doc reflects reality, not the original v0 plan.

---

## Phase 0 — Repo setup (one person, day 0)

- [x] **T0.1** `[chore/monorepo-init]` Monorepo with pnpm workspaces. `apps/web`, `apps/api`, `apps/contracts`, `packages/shared`, `packages/config`. Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, shared eslint + prettier.
- [ ] **T0.2** `[chore/ci]` GitHub Actions: lint + typecheck + Hardhat tests on PR. No deploy yet.
- [x] **T0.3** `[chore/env]` Root `.env.example` documenting every required env var across packages.
- [x] **T0.4** `[chore/claude-md]` Per-package `CLAUDE.md` files exist.

---

## Phase 1 — Frontend skeleton (frontend dev)

- [ ] **T1.1** `[web/init]` Vite + React 19 + TS in `apps/web`. Tailwind. shadcn/ui CLI initialized with Button, Input, Card, Tabs, Dialog, Sheet, Toast.
- [ ] **T1.2** `[web/web3-provider]` Install wagmi, viem, RainbowKit. `Web3Provider` wrapping the app. Configure local Hardhat (31337) + Base Sepolia. `<ConnectButton />` in the header.
- [ ] **T1.3** `[web/layout]` App shell: header (logo, nav: Home / Create / Portfolio, ConnectButton), responsive container, mobile bottom nav.
- [ ] **T1.4** `[web/odds-formatter]` `useOddsFormatter` hook that takes a TAB-denominated probability and returns either `0.45 TAB` or `2.22x`. Reads global toggle from `useOddsMode` backed by `localStorage`. Header toggle switch.
- [ ] **T1.5** `[web/claim-button]` Claim button visible when the connected wallet has zero TAB and `claimAuthorized[user]` is true. Calls `TABcoin.claim()`. Disabled with a tooltip when not authorized (and the user is told to ping the team to grant `CLAIM_AMOUNT` allowance). Required for any judge to be able to interact on demo day.

---

## Phase 2 — Markets list and detail (frontend dev, parallel with Phase 3 backend)

- [ ] **T2.1** `[web/market-card]` `MarketCard` component. Props: title, category, probability (0–1), verified (bool), volume. Uses `useOddsFormatter`. Verified badge.
- [ ] **T2.2** `[web/home]` Home page (`/`). Category tabs (Politics, Crypto, Sports, Economics, Other). Grid of `MarketCard`. Pulls from backend `GET /api/markets?category=...`. Uses TanStack Query (already in via wagmi).
- [ ] **T2.3** `[web/market-detail]` `/market/:id` page. Left: title, resolution criteria (prominent), placeholder for chart, market metadata. Right: trading panel.
- [ ] **T2.4** `[web/trading-panel-simple]` Simple-mode panel: Yes/No big buttons, TAB amount input, computed potential payout from backend `GET /api/markets/:id/quote`. Take button. **Blocker: simple-mode liquidity strategy** (see `plan.md` open design question). Decide before implementing the take wiring.
- [ ] **T2.5** `[web/trading-panel-pro]` Pro-mode panel: live `TabClob` order book (read-only first), then minimal limit order entry (EIP-712 sign → POST to backend mempool).
- [ ] **T2.6** `[web/take-tx]` Wire the Take button to wagmi: `useSimulateContract` → `useWriteContract` against `TabClob.fill` with the chosen maker order. TAB approve-then-fill pattern. Toast on each step. Invalidate market + portfolio queries on confirm.

---

## Phase 3 — Backend core (Python / FastAPI)

- [x] **T3.1** `[api/init]` FastAPI in `apps/api`. Health endpoint at `/health` and `/api/v1/health`. CORS via `CORSMiddleware`. uv + pyproject + ruff + mypy strict + pytest. Structured logging is **TBD** (T3.1b).
- [ ] **T3.1b** `[api/logging]` Structured JSON logs (`python-json-logger`). Request-ID middleware. Hide secrets in logs.
- [ ] **T3.2** `[api/db-schema]` Pick SQLite + SQLModel (default, zero infra) or Postgres + SQLAlchemy 2.0. Tables: `Market`, `MarketEvent` (indexer log), `Position` (denormalized cache), `Order` (CLOB maker mempool, if we choose to host orders), `User`. Migrations via Alembic.
- [ ] **T3.3** `[api/markets-read]` `GET /api/markets`, `GET /api/markets/:id`, `GET /api/markets/:id/quote`. Pydantic response models. Quote endpoint reads `TabClob` book via `web3.py`.
- [ ] **T3.4** `[api/indexer]` Worker subscribing to `PredictionMarketV2.MarketCreated`, `ConditionalTokens.PayoutsReported`, `PositionWrapperFactory.WrapperCreated`, `TabClob.Filled`. Writes to `MarketEvent` and updates `Market` / `Position` projections. Idempotent: same block range twice = same DB state. Local Hardhat first, Base Sepolia behind `API_CHAIN_ID`. Run as a background asyncio task spawned at FastAPI startup.
- [ ] **T3.5** `[api/siwe]` SIWE middleware (EIP-4361). Signed-in users can `POST /api/markets` (metadata only, the on-chain creation is separate) and `PATCH /api/markets/:id` (their own).
- [ ] **T3.6** `[api/clob-mempool]` `POST /api/orders` accepts an EIP-712 signed `TabClob` order, validates the signature against the maker, stores it. `GET /api/markets/:id/orders` returns the live book. Decision dependency: do we host orders centrally? See `plan.md`.

---

## Phase 4 — Contracts

> Most of this phase is already implemented in `apps/contracts/packages/hardhat/contracts/`. Tasks below are reframed as **verify / harden / deploy**, not greenfield builds.

- [x] **T4.1** `[contracts/init]` Scaffold-ETH 2 (Hardhat flavor) initialized. `hardhat-deploy` chosen. OpenZeppelin v5.
- [x] **T4.2** `[contracts/tabcoin]` `TABcoin.sol` shipped — ERC-20 + burnable + hardcoded `AUTHORIZER` + `claim()` allowance pattern. (Note: this is **not** the open `faucet()` originally planned; the design uses an authorizer-granted claim. UI must reflect that.)
- [x] **T4.3** `[contracts/conditional-tokens]` `ConditionalTokens.sol` shipped — lightweight Gnosis-CTF-compatible ERC-1155, no nested conditions, binary/multi/scalar/ordinal outcomes.
- [x] **T4.4** `[contracts/prediction-market-v2]` `PredictionMarketV2.sol` shipped — lifecycle + curation + bond layer over ConditionalTokens. Per-market oracle is the auth.
- [x] **T4.5** `[contracts/position-wrapper]` `PositionWrapper.sol` + `PositionWrapperFactory.sol` shipped — `Clones`-based ERC-1155 → ERC-20 wrappers, deterministic.
- [x] **T4.6** `[contracts/tab-clob]` `TabClob.sol` shipped — EIP-712 ERC-20 limit order book. Off-chain orders, on-chain `fill`. ECDSA + EIP-1271.
- [ ] **T4.7** `[contracts/tests-audit]` Audit existing tests in `packages/hardhat/test/`. Each fund-moving external function gets one happy-path and one revert. Cover at minimum: `TABcoin.claim` / `mint` / `authorize` / `revoke`, `ConditionalTokens.prepareCondition` / `splitPosition` / `mergePositions` / `redeemPositions` / `reportPayouts`, `PredictionMarketV2.createMarket` / `resolve` / `claimBond` / `slashBond`, `PositionWrapperFactory.createWrapper`, `PositionWrapper.wrap` / `unwrap`, `TabClob.fill` / `cancel`. Run `audit-bet` skill before merging.
- [ ] **T4.8** `[contracts/seed-demo-markets]` Deploy script that, after `06_seed_accounts`, creates 3 demo markets via `PredictionMarketV2.createMarket`, mints full sets, wraps both outcomes, and posts opening orders to `TabClob` (or to the backend order mempool, depending on T3.6). Removes the SE-2 `YourContract.sol` from the deploy pipeline.
- [ ] **T4.9** `[contracts/deploy-base-sepolia]` (later, post-MVP) Deploy to Base Sepolia. Outputs into `packages/shared/src/addresses/baseSepolia.json` and `packages/shared/src/abis/`. Verify on Etherscan via `yarn verify --network baseSepolia`.

---

## Phase 5 — AI assistant (Kowalsky) (backend + frontend pair)

- [ ] **T5.1** `[api/llm-proxy]` `POST /api/chat`. Body: Pydantic `ChatRequest` (`messages`, `userAddress?`). Forwards to the chosen LLM (decide OpenAI vs. Anthropic first) with a system prompt and a tools schema. Returns `ChatResponse` (`message`, `transactionCards[]`). Provider behind `src/api/llm/provider.py`. Rate-limit per IP and per address.
- [ ] **T5.2** `[api/llm-tools]` Implement tool handlers in `src/api/llm/tools.py`: `search_markets`, `get_market`, `get_user_positions`, `prepare_take`, `prepare_create_market`, `prepare_claim`. Each handler validates inputs/outputs with Pydantic. The `prepare_*` handlers compose Transaction Card payloads — they do not call the chain to write.
- [ ] **T5.3** `[shared/tx-card-schema]` Zod schema for `TransactionCard` in `packages/shared`. Fields: `chainId`, `to`, `abiName`, `functionName`, `args`, `humanSummary`. Frontend imports the Zod schema; backend has an equivalent Pydantic model (kept in sync — TBD codegen vs. hand-mirror).
- [ ] **T5.4** `[web/chat-widget]` `ChatWidget` component: floating button bottom-right, opens a sheet (mobile) or panel (desktop). Message history, user/assistant bubbles, input with mic button (Web Speech API). Calls `POST /api/chat`.
- [ ] **T5.5** `[web/ai-tx-card]` `AITransactionCard` component rendered inline in chat. Validates the card against the shared Zod schema, then against the address book (target must be a known contract on the current chain). Approve & Sign button → `useSimulateContract` → `useWriteContract`. Disabled if validation fails, with a clear error.
- [ ] **T5.6** `[web/voice-input]` Wire the mic button to Web Speech API. Fall back to a clear "voice not supported in this browser" message. (Whisper via backend is a stretch task, not in MVP.)

---

## Phase 6 — Generative market creation

- [ ] **T6.1** `[web/create-page]` `/create` page. Big textarea (or mic) with placeholder "What do you want to predict?". Submits to `POST /api/chat` with `intent: "create_market"`.
- [ ] **T6.2** `[web/generated-market-form]` `GeneratedMarketForm` component. Pre-filled from the LLM draft: title, description, resolution criteria, expiry. Editable. Bond input (default 50 TAB).
- [ ] **T6.3** `[web/create-tx]` Wire "Create & Lock Bond" to wagmi: TAB approve → `PredictionMarketV2.createMarket`. After confirm, `POST /api/markets` to attach metadata (title, description, criteria, category) to the indexed `marketId`.

---

## Phase 7 — Portfolio and curation

- [ ] **T7.1** `[web/portfolio]` `/portfolio` page. Three sections: Open, Claimable, History. Pulls from `GET /api/users/:address/positions`.
- [ ] **T7.2** `[api/portfolio]` `GET /api/users/:address/positions`. Joins `Position` with `Market`. For each position, reports: wrapped outcome ERC-20 balance, conditionId, whether the market has reported payouts, claimable TAB amount.
- [ ] **T7.3** `[web/claim]` Claim button on claimable positions → `useWriteContract` against `ConditionalTokens.redeemPositions`. (Wrapped tokens are unwrapped first via `PositionWrapper.unwrap`.)
- [ ] **T7.4** `[web/curator-actions]` On a market detail page, if the connected wallet is the market `oracle` on `PredictionMarketV2`, show **Resolve** and **Slash bond** buttons. Wire to the corresponding contract calls.

---

## Phase 8 — Polish (whoever has time)

- [ ] **T8.1** `[web/chart]` Real probability chart on market detail. Line chart from `MarketEvent` history. Recharts.
- [ ] **T8.2** `[web/empty-states]` Empty states everywhere: no markets, no positions, no chat history.
- [ ] **T8.3** `[web/error-boundaries]` Error boundary around chat and trading panel. Toasts for tx failures with the actual revert reason.
- [ ] **T8.4** `[chore/seed]` Seed script: deploy contracts, create 6–8 demo markets, wrap outcomes, seed maker liquidity on `TabClob`. Run before demo.
- [ ] **T8.5** `[chore/demo-checklist]` Manual checklist file `docs/demo-checklist.md`. Covers every flow from `CLAUDE.md` "Demo definition of done". Run on demo day, on a fresh wallet, on phone and desktop.

---

## TODOs to resolve before the dependent task starts

- LLM provider (OpenAI vs. Anthropic). Blocks **T5.1**.
- Backend DB choice (SQLite + SQLModel vs. Postgres + SQLAlchemy 2.0). Blocks **T3.2**.
- Simple-mode liquidity strategy (maker bot vs. factory-seeded vs. no simple mode). Blocks **T2.4**.
- CLOB order hosting (centralized in our DB vs. shared off-chain pool). Blocks **T3.6**.
- TransactionCard schema sync between Zod and Pydantic (codegen vs. hand-mirror). Blocks **T5.3**.
- Router choice (TanStack Router vs. React Router). Blocks **T1.3**.
