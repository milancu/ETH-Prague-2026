# Constitution

These rules are absolute. They cannot be broken during implementation. If a task appears to require breaking one of them, stop and escalate to the team.

## 1. Goal

Ship a working prediction market dApp that a real user can use end-to-end on Base Sepolia by demo day. Working > pretty, working > complete. A judge must be able to connect a wallet and place a bet without a developer holding their hand.

## 2. Stack (frontend)

- Vite + React 19 + TypeScript. No Next.js, no other meta-framework.
- Styling: **Tailwind CSS** and **shadcn/ui** components only. **No hand-written CSS files.** No CSS-in-JS, no styled-components.
- Web3: **wagmi + viem + RainbowKit**. Direct use of `ethers.js` or `window.ethereum` is forbidden.
- State: React hooks (`useState`, `useReducer`) for UI state. wagmi's built-in caching (React Query under the hood) for chain data. **No Redux, no Zustand, no MobX.**
- Mobile-first. Every screen, including the AI chat and the trading panel, must be fully usable on a phone.

## 3. Stack (backend)

- **Python 3.12 + FastAPI**, managed with `uv`. Latest stable.
- Validation: **Pydantic v2** for every request body, response, and LLM tool I/O. No untyped routes.
- Database: **TODO** — pick one before task `api-db-schema`. Default lean: SQLite + SQLModel for zero infra; Postgres + SQLAlchemy 2.0 if we need it. Either way, schema is checked into the repo.
- Chain reads from Python: **TODO** — `web3.py` is the default; consider running viem under Node only inside `apps/contracts/`. Do not call chain RPCs by hand.
- LLM access goes through the backend, never directly from the browser. The browser never sees the LLM API key.
- Tests: **pytest**. Linting: **ruff**. Typing: **mypy strict**.

## 4. Stack (contracts)

- Solidity ^0.8.24, latest stable compiler.
- **Hardhat + TypeScript** for build, test, and deploy. No Foundry. `ethers` v6 only inside `apps/contracts/packages/hardhat/` (tests, deploy, scripts) — this is the **only** allowed use of ethers in the repo. Frontend uses viem/wagmi exclusively.
- `apps/contracts/` is a Scaffold-ETH 2 monorepo (`packages/hardhat/` + `packages/nextjs/` debug UI). Production frontend lives in `apps/web/`.
- **Local Hardhat network is the primary target during development.** Every contract must run, deploy, and pass tests on `npx hardhat node`. Base Sepolia is a later integration target, not the day-to-day environment.
- Underlying asset: **TABcoin** (`TAB`, our own ERC-20). Burnable, with a hardcoded `AUTHORIZER` address that mints supply and grants per-address claim allowances (`CLAIM_AMOUNT` per allowance). No USDC dependency anywhere. The `AUTHORIZER` pattern is the explicit, documented exception to the "no `onlyOwner` shortcuts" rule.
- Conditional tokens: **`ConditionalTokens.sol`** — our own lightweight Gnosis-CTF-compatible ERC-1155. Binary, multi, scalar, ordinal outcomes. No nested conditions.
- Position wrapping: **`PositionWrapper`** + **`PositionWrapperFactory`** — `Clones`-based ERC-1155 → ERC-20 wrappers per `(collateral, conditionId, indexSet)`. Outcome shares trade as ERC-20.
- Trading: **`TabClob.sol`** — minimal EIP-712 ERC-20 limit order book. Off-chain signed orders, on-chain atomic fill. There is **no AMM**; simple-mode UI must be designed against the CLOB (open design question — see `plan.md`).
- Lifecycle + curation + bond: **`PredictionMarketV2.sol`**. Registered as oracle for each market it creates; per-market `oracle` is the auth.
- Oracle / resolution: **mocked**. The per-market oracle (admin/curator) resolves manually via `PredictionMarketV2`. No UMA integration in the hackathon scope.

## 5. AI consent rule

The AI assistant ("Kowalsky") **never** sends an on-chain transaction by itself.

The AI's only on-chain output is a structured "Transaction Card" rendered in the chat. The user must explicitly click an approve button **and** sign in their wallet before any state-changing call hits the chain. Read-only RPC calls and read-only API calls are fine.

This applies to every feature, including market creation, betting, claiming, and liquidity provision.

## 6. Security rules

- No secrets, no private keys, no API keys in the repo. Ever. Use `.env`, ship `.env.example`.
- Every Solidity function that moves funds has at least one happy-path test and one revert test.
- Reentrancy guards on every external state-changing function that interacts with ERC-20/ERC-1155.
- The frontend never trusts data from the AI. Every transaction the AI proposes is reconstructed and validated client-side before signing (correct contract address, correct function, sane amounts, user-approved slippage).
- The backend never trusts user input that is forwarded to the LLM. Sanitize and length-limit all prompts.

## 7. Process rules

- Monorepo, one branch per feature, branch name `<package>/<short-name>`, PRs into `main`.
- Conventional Commits, scope = package (`feat(web): ...`, `fix(contracts): ...`).
- AI does most of the writing. AI also reviews every PR against this constitution before merge; the review is pasted in the PR description.
- Tests are minimal but mandatory for money-touching contract code (see rule 6) and for non-trivial pure logic (odds formatter, AI response parser, market schema validator). Do not write tests for trivial UI.
- Latest stable releases of every dependency. Beta versions only with a written reason in the PR.
- Deployment: own hardware. Frontend served as static build, backend as a long-running `uvicorn` process. Contracts run on the local Hardhat network during development; Base Sepolia deployment is a separate later step before demo day.

## 8. Definition of done

The flows listed in [`CLAUDE.md`](../CLAUDE.md) under "Demo definition of done" all work end-to-end on the **local Hardhat network** at minimum, and on **Base Sepolia** if the testnet deployment lands in time. From a fresh wallet, on both desktop and a phone-sized viewport. If any of those flows is broken on the target chosen for demo day, the project is not done.
