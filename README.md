# PredictAI

A prediction market dApp for the Czech market with an AI co-pilot. Built at a hackathon. Local Hardhat for development, Base Sepolia for the public demo.

## What it is

A platform where anyone can create, trade, and resolve bets on future events. An AI assistant called Kowalsky helps users find markets, prepare trades, and create new ones in plain language. The AI never signs transactions — every trade is approved and signed by the user.

For details, see [`docs/spec.md`](./docs/spec.md).

## For AI agents

Read [`CLAUDE.md`](./CLAUDE.md) first. Then `docs/constitution.md`, `docs/spec.md`, `docs/plan.md`, `docs/tasks.md`, and the `CLAUDE.md` of the package you are working in.

## For humans

```bash
pnpm install
cp .env.example .env       # fill in keys
pnpm dev                   # starts web + api
```

Per-package commands live in each app's README.

## Repo layout

```
apps/web         frontend (Vite + React + TS)
apps/api         backend (FastAPI + Python, uv)
apps/contracts   Scaffold-ETH 2 monorepo (Hardhat + Solidity, NextJS debug UI)
packages/shared  shared types, ABIs, address book
packages/config  shared eslint, tsconfig, prettier
docs             spec kit (constitution, spec, plan, tasks)
```

## Stack

Frontend: Vite, React 19, TypeScript, Tailwind, shadcn/ui, wagmi, viem, RainbowKit.
Backend: Python 3.12, FastAPI, uv, Pydantic v2, web3.py.
Contracts: Solidity, Hardhat (TypeScript). TABcoin (TAB ERC-20), ConditionalTokens (Gnosis-CTF-compatible ERC-1155), PredictionMarketV2 (lifecycle + bond), PositionWrapper (ERC-1155 → ERC-20), TabClob (EIP-712 limit order book). Local Hardhat network primary, Base Sepolia later.
AI: LLM via backend proxy with function calling. Web Speech API for voice input.

## License

TBD.
