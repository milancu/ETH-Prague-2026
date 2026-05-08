# apps/api — CLAUDE.md

Backend rules. Read the root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/constitution.md`](../../docs/constitution.md) first.

## Stack

- **Python 3.12 + FastAPI**, managed with `uv`. Latest stable.
- **Pydantic v2** for every request body, response, and LLM tool I/O. No untyped routes. No `Any`.
- DB: **TBD** before `T3.2`. Default: SQLite + SQLModel (zero infra). Postgres + SQLAlchemy 2.0 if we want a real DB. Migrations via Alembic either way.
- **web3.py** for chain reads (and reads only — the backend never holds a private key for user actions).
- Logging: standard `logging` + `python-json-logger`. Lint: **ruff**. Types: **mypy strict**. Tests: **pytest** + **httpx**.

## Project layout

```
apps/api/
├── pyproject.toml
├── uv.lock
├── src/api/
│   ├── main.py          # FastAPI app, middleware, router include
│   ├── routes/          # one router per concern (markets, chat, users, orders, auth)
│   ├── services/        # business logic, called from routes
│   ├── llm/             # provider.py (SDK abstraction), tools.py (tool handlers)
│   ├── indexer/         # event subscriber + projection writers
│   ├── db/              # SQLModel models + session + migrations
│   └── lib/             # cross-cutting helpers
└── tests/               # pytest, mirrors src layout
```

## Conventions

- One router per concern. Mount under `/api/v1/...`.
- Every route declares `response_model=` and a Pydantic body model. No raw dicts in or out.
- Errors: raise `HTTPException` or a custom domain exception caught by an app-wide handler. Never silently swallow.
- Async by default. Sync only for CPU-bound work, run in a thread pool.
- Imports: ruff isort (`I`) enforced. Module aliases over deep paths.

## LLM rules

- The system prompt explicitly tells the model: never invent a market that does not appear in tool results, never propose a transaction without calling a `prepare_*` tool first, never emit raw addresses to the user — always reference markets by `marketId`.
- Tool inputs and outputs are Pydantic-validated on both sides.
- `prepare_*` tools build a `TransactionCard` (shared schema, see `T5.3`). They do not write to the chain. They may simulate via `web3.py` to get an expected payout, but never sign.
- Rate-limit `POST /api/chat` per IP and per signed-in address (e.g. `slowapi`).
- Sanitize and length-limit the user-provided portion of prompts. Strip control characters.
- Provider behind `src/api/llm/provider.py` so swapping OpenAI ↔ Anthropic is a one-file change.

## Indexer rules

- Idempotent. Re-running on the same block range produces the same DB state.
- Stores raw `MarketEvent` rows plus denormalized projections in `Market` and `Position`. Projections can always be rebuilt from events.
- Reorg handling: keep the last N block hashes, on a mismatch roll back the projection and re-index from the divergence point. (Local Hardhat has no reorgs; for Base Sepolia hackathon scope, `N=20` is fine.)
- Events to subscribe to: `PredictionMarketV2.MarketCreated` / `Resolved` / `BondClaimed` / `BondSlashed`, `ConditionalTokens.ConditionPreparation` / `PayoutsReported` / `PositionSplit` / `PositionsMerged`, `PositionWrapperFactory.WrapperCreated`, `TabClob.Filled` / `Cancelled`.

## Security

- No secrets in code. `.env` only. List in `.env.example`.
- CORS allow-lists the deployed frontend origin and `localhost:5173`.
- SIWE-protected endpoints check the signed message against the request body, not the other way around.
- The backend has no private key that can move user funds. Period.
- Never trust user-provided text forwarded to the LLM. Length-limit + strip control chars.

## Testing

- pytest + httpx. Tests for: LLM tool handlers (input/output shape), the AI card builder (`prepare_*` correctness), and the indexer event-to-projection logic.
- No tests for trivial route handlers.
- `pytest -q` in CI. mypy strict on every PR.

## Don'ts

- No `Any` in checked-in code. Use `TypeVar`, `TypedDict`, or define the type.
- No raw SQL strings in route handlers — go through SQLModel/SQLAlchemy.
- No raw `requests` to chain RPCs. Use `web3.py`.
- No raw `requests` to the LLM provider — go through `src/api/llm/provider.py`.
- No private keys ever, even for "testing".
