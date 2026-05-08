# CLAUDE.md

This file is the entry point for any AI agent (Claude Code, Cursor, etc.) working on this repository. **Read this file first, then read the documents it points to.**

## What this project is

A prediction market dApp for the Czech market, built at a hackathon. Users create, buy, sell, and resolve bets on future events (politics, sports, crypto, culture, economics). An AI assistant ("Kowalsky") helps users find markets, prepare trades, and create new markets via natural language. AI **never** signs transactions — it only prepares them.

For full product description see [`docs/spec.md`](./docs/spec.md).

## Read these in order before doing any work

1. [`docs/constitution.md`](./docs/constitution.md) — non-negotiable rules. Read every time.
2. [`docs/spec.md`](./docs/spec.md) — what we are building, in user-facing terms.
3. [`docs/plan.md`](./docs/plan.md) — technical architecture and stack.
4. [`docs/tasks.md`](./docs/tasks.md) — broken-down work items.
5. The `CLAUDE.md` inside the package you are working in (e.g. `apps/web/CLAUDE.md`) — package-specific conventions.

## Repository layout

This is a monorepo. Every package has its own `CLAUDE.md` with rules specific to that package.

```
.
├── CLAUDE.md                  # you are here
├── README.md                  # human-facing readme
├── docs/
│   ├── constitution.md        # absolute rules
│   ├── spec.md                # what we build
│   ├── plan.md                # how we build it
│   └── tasks.md               # work items
├── apps/
│   ├── web/                   # frontend (Vite + React + TS)
│   │   └── CLAUDE.md
│   ├── api/                   # backend (FastAPI + Python, uv)
│   │   └── CLAUDE.md
│   └── contracts/             # Scaffold-ETH 2 monorepo: Solidity (Hardhat) + debug NextJS UI
│       ├── AGENTS.md
│       └── CLAUDE.md
└── packages/
    ├── shared/                # shared TS types, ABIs, market schemas
    └── config/                # shared eslint, tsconfig, prettier
```

## Working rules for AI agents

- **Never violate the constitution.** If a task seems to require breaking a rule, stop and ask the human.
- **One branch per feature.** Branch naming: `<package>/<short-feature-name>`, e.g. `web/market-card`, `contracts/ctf-mock`, `api/markets-read`. Branch off `main`. Merge via PR.
- **Commits:** Conventional Commits. `feat(web): add market card`, `fix(contracts): correct payout math`, `chore(api): bump fastapi`. Scope = package name.
- **Tests are minimal but mandatory for money-touching code.** Solidity: every external function that moves funds has at least one happy-path and one revert test. Frontend/backend: tests only where logic is non-trivial (e.g. odds formatter, AI response parser). Do not write tests for trivial UI.
- **AI-driven code review.** Before opening a PR, ask Claude to review the diff against the constitution and the relevant package `CLAUDE.md`. Paste the review into the PR description.
- **Latest stable releases.** Use the newest stable version of every dependency. If something is in beta and required (e.g. wagmi v2 features, viem latest), document why in the PR.
- **No secrets in the repo.** Use `.env` files, list every required key in `.env.example`.

## Demo definition of done

The judges must see a working app where a user can:

1. Connect a wallet (RainbowKit) on the local Hardhat network (or Base Sepolia if that deployment is ready).
2. Browse a list of markets and open one.
3. Place a Yes/No bet through the simple-mode UI, sign the tx, and see the position in their portfolio.
4. Talk to Kowalsky in chat ("I want to bet 10 TAB that X happens"), see a transaction card, click approve, sign, succeed.
5. Create a new market through the generative flow, post a bond, and see it appear (curator status: unverified).
6. (Stretch) Claim winnings on a resolved market.

If any of 1–5 is broken on demo day, the project is not done. 6 is nice to have.

## Out of scope for the hackathon

- Mainnet deployment.
- Real UMA optimistic oracle (we mock resolution; admin/curator wallet resolves markets manually via `PredictionMarketV2`).
- Full pro-mode maker tooling on `TabClob` (advanced order types, partial-fill UI, cancel-all). Read-only book + minimal order entry is in scope.
- Cron-based agent notifications.
- Mobile native apps. Web is mobile-first responsive, that is enough.
- USDC integration. We use TABcoin (`TAB`).

## Decisions still pending

These are tracked as `TODO` in the relevant doc. Resolve with the team before the work that depends on them starts.

- LLM provider for Kowalsky: OpenAI vs. Anthropic. Function calling either way.
- Speech-to-text: Web Speech API (free, browser) for MVP, Whisper as upgrade if time allows.
- Backend DB: SQLite + SQLModel vs. Postgres + SQLAlchemy 2.0. Decide before `T3.2`.
- Simple-mode trading flow against `TabClob` — open design question, see `plan.md`.
