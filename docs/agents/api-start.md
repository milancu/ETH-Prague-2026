# Start prompt — apps/api (backend, Python)

You are working on the **backend** of a hackathon prediction market dApp. The repo already exists and has some code in it. **Do not start from scratch and do not rewrite anything before you have surveyed what is there.**

The backend is **Python 3.12 + FastAPI + uv**. It is **not** TypeScript / Fastify — older drafts of the docs may still mention that; trust the code, not stale docs.

## Step 1 — Read the spec kit, in this order

1. `CLAUDE.md` (repo root) — entry point.
2. `docs/constitution.md` — non-negotiable rules.
3. `docs/spec.md` — what we are building.
4. `docs/plan.md` — technical architecture, especially the LLM tool schema and indexer sections.
5. `docs/tasks.md` — work items. Your tasks are `T3.x`, `T5.1`, `T5.2`, `T5.3` (with frontend), `T7.2`.
6. `apps/api/CLAUDE.md` — backend-specific rules.

## Step 2 — Survey what already exists

Before writing anything, run:

```
ls -la apps/api
cat apps/api/pyproject.toml
cat apps/api/package.json
```

Then look at `src/api/` — FastAPI setup, routes, services, db, llm proxy, indexer. Note in your reply:

- What is already built that maps to a task in `tasks.md`.
- What is built but conflicts with the constitution or `apps/api/CLAUDE.md` (LLM key reachable from the browser, untyped routes, raw `requests` to chain RPCs instead of `web3.py`, secrets in code, missing Pydantic validation, untyped `Any`).
- What is missing.

**Do not edit anything in this step. Just report.**

## Step 3 — Reconcile, do not overwrite

For each conflict:

- **Constitution violations** that touch security (LLM key in frontend bundle, secrets in repo, write endpoints without SIWE, LLM tool handlers that do on-chain writes themselves) — flag as blockers, propose the fix, wait for human approval.
- **Stylistic drift** (file structure, naming, sync calls where async is expected) — note it, do not refactor unprompted.
- **Missing** — that is a task. Branch off `main` as `api/<short-name>`, implement, PR.

If the existing code uses a stack element not in the constitution (Flask instead of FastAPI, raw `psycopg` instead of SQLModel/SQLAlchemy, no Pydantic, calling the LLM provider directly from a browser-facing endpoint without proxy logic), call it out and ask before migrating.

## Working rules (summary — full rules in `apps/api/CLAUDE.md`)

- Stack: **Python 3.12 + FastAPI + uv**, Pydantic v2 on every boundary, SQLModel/SQLAlchemy + Alembic for DB, `web3.py` for chain reads only.
- The backend **never** holds a private key that can move user funds. Read-only chain access only.
- Every route declares `response_model=` and a Pydantic body model. No untyped routes. No `Any`.
- LLM proxy at `POST /api/v1/chat`. The browser **never** sees the LLM API key. Rate-limit per IP and per address.
- LLM tool handlers (`prepare_take`, `prepare_create_market`, `prepare_claim`, etc.) build `TransactionCard` payloads. They do **not** sign or send anything.
- Indexer is idempotent. Same block range twice = same DB state.
- SIWE for write endpoints on metadata + CLOB order posting. Read endpoints are public.
- One PR per task. Branch: `api/<short-name>`. Conventional Commits: `feat(api): ...`, scope = `api`.
- Tests for: LLM tool handlers, the AI card builder, indexer event-to-projection logic. Nothing else.
- `pytest -q` + `ruff check .` + `mypy --strict src/` must pass before opening a PR.

## What to ship first if nothing is there yet

In order: `T3.1b` (structured logging on top of the existing `T3.1` health endpoint) → `T3.2` (DB schema — pick SQLite + SQLModel for zero infra, Postgres + SQLAlchemy if you want a real DB; decide first) → `T3.3` (markets read endpoints) → `T3.4` (indexer) → `T5.1` (LLM proxy) → `T5.2` (LLM tools) → `T5.3` (with frontend, define the shared TransactionCard Zod schema in `packages/shared` first; mirror to Pydantic on the backend) → `T3.5` (SIWE) → `T3.6` (CLOB order mempool) → `T7.2` (portfolio).

The frontend can mock your endpoints, so do not block frontend work. Ship `T3.3` early even if it returns dummy data — frontend just needs the shape.

## Coordination points with frontend and contracts

- **`packages/shared`** is the integration contract. Define types there before writing code that depends on them. Especially `TransactionCard` (T5.3) — frontend imports the Zod schema, backend mirrors it as a Pydantic model. They must agree.
- **Address book** at `packages/shared/src/addresses/<chain>.json` — read by both your indexer and the frontend. Do not duplicate addresses anywhere.
- **ABIs** at `packages/shared/src/abis/` — generated from Hardhat artifacts by the contracts package (`apps/contracts/packages/hardhat/scripts/generateTsAbis.ts`). Treat as read-only.
- **Real contracts on chain (not the v0 plan):** `TABcoin`, `ConditionalTokens`, `PredictionMarketV2`, `PositionWrapperFactory` + `PositionWrapper`, `TabClob`. There is **no** `BinaryAMM` / `MarketFactory` / `PRED` / `MinimalCTF` / `Curator` / `Resolver` despite earlier draft docs — those names are stale.
- The chain to point your indexer and `web3.py` reader at: `hardhat` (`http://127.0.0.1:8545`, chainId 31337) for development, `baseSepolia` later. Read from `API_CHAIN_ID` env var, do not hardcode.

## What to do if you are blocked

- Contracts not deployed yet? Indexer task can wait — start with markets-read returning DB rows that you seeded by hand, frontend can already render.
- LLM provider not picked yet? Implement `T5.1` against an interface, hide the actual SDK behind one file (`src/api/llm/provider.py`) so swapping later is one file change.
- Simple-mode CLOB liquidity strategy is unresolved (see `plan.md` open question). Your `prepare_take` tool should still work against a hand-seeded order book — coordinate with the contracts dev to seed orders.
- Any ambiguity in the spec? Ask in the PR description, do not guess.

Now do Step 1, then Step 2, and reply with your survey. Only after the survey do we agree on the first task.
