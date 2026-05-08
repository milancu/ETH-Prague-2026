# apps/contracts — CLAUDE.md

@AGENTS.md

Solidity rules. Read the root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/constitution.md`](../../docs/constitution.md) first. Generic Scaffold-ETH 2 patterns (Hardhat/NextJS workflow, hook names, deploy commands, code style) live in [`AGENTS.md`](./AGENTS.md) — pulled in by the `@AGENTS.md` line above.

## Layout

`apps/contracts/` is a **Scaffold-ETH 2 monorepo** (Hardhat flavor):

```
apps/contracts/
├── packages/
│   ├── hardhat/        # Solidity, deploy, tests
│   │   ├── contracts/
│   │   ├── deploy/
│   │   └── hardhat.config.ts
│   └── nextjs/         # SE-2 dev frontend (NOT the production web app — that's apps/web/)
└── AGENTS.md
```

The production frontend is `apps/web/` (Vite + React + viem/wagmi). `packages/nextjs/` exists only as an SE-2 contract-debugging UI.

## Stack

- Solidity `^0.8.24`, OpenZeppelin v5 (`ERC20`, `ERC1155`, `SafeERC20`, `ReentrancyGuard`, `EIP712`, `Clones`, `SignatureChecker`).
- **Hardhat + TypeScript** with `hardhat-deploy` (deploy scripts numbered `00…07`). **No Foundry.**
- `ethers` v6 only inside `packages/hardhat/` (tests, deploy, scripts). Frontend uses viem/wagmi. Do not export ethers types into shared packages.
- Networks in `hardhat.config.ts`: `hardhat`, `localhost`, `baseSepolia` (env-gated on `BASE_SEPOLIA_RPC_URL` + `DEPLOYER_PRIVATE_KEY`).
- Primary dev target: **local Hardhat network**. Base Sepolia is a later integration step.

## Contracts

In `packages/hardhat/contracts/`:

- **`TABcoin.sol`** — ERC-20 (`TAB`, 18 decimals), burnable. Hardcoded `AUTHORIZER` address mints and grants per-address claim allowances (`CLAIM_AMOUNT` per allowance). **Only collateral token in the system.** No USDC.
- **`ConditionalTokens.sol`** — Lightweight Gnosis-CTF-compatible ERC-1155. Binary, multi, scalar, ordinal outcomes. No nested conditions (parent collection always `0`). A full set of N outcome tokens = 1 unit of collateral.
- **`PredictionMarketV2.sol`** — Lifecycle + curation + bond layer over `ConditionalTokens`. Registered as the oracle for every market it creates; per-market `oracle` is the auth. Users call `splitPosition` / `mergePositions` / `redeemPositions` directly on `ConditionalTokens`.
- **`PositionWrapper.sol`** + **`PositionWrapperFactory.sol`** — `Clones`-based ERC-1155 → ERC-20 wrappers per `(collateral, conditionId, indexSet)`. Idempotent and deterministically mapped.
- **`TabClob.sol`** — Minimal EIP-712 ERC-20 limit order book. Off-chain signed orders, on-chain atomic fill. Both sides approve TabClob. `SignatureChecker.isValidSignatureNow` covers ECDSA EOAs + EIP-1271 smart wallets.
- **`YourContract.sol`** — SE-2 boilerplate. Safe to delete once nothing references it.

## Mandatory rules

- Every external state-changing function that moves funds: `nonReentrant` + `SafeERC20` for ERC-20 transfers.
- Custom errors, not `require` strings (gas + clarity).
- Role-based auth (`AccessControl` or per-market role). No `onlyOwner` shortcuts. TABcoin's hardcoded `AUTHORIZER` is the explicit, documented exception.
- Events for every state change. The indexer relies on them.
- Checks-Effects-Interactions.
- No `delegatecall`, no `selfdestruct`, no inline assembly unless justified in the PR.

## Tests

In `packages/hardhat/test/`. Mandatory minimum:

- Every external function that moves funds: one happy-path test + one revert test.
- At minimum cover: `TABcoin.claim` / `mint` / `authorize` / `revoke`, `ConditionalTokens.prepareCondition` / `splitPosition` / `mergePositions` / `redeemPositions` / `reportPayouts`, `PredictionMarketV2.createMarket` / `resolve` / `claimBond` / `slashBond`, `PositionWrapperFactory.createWrapper`, `PositionWrapper.wrap` / `unwrap`, `TabClob.fill` / `cancel`.
- Property checks via `fast-check` recommended for CTF math invariants and CLOB partial fills.
- No mainnet forking in CI. Gas reporter output is enough.

## Deployment

Deploy scripts in `packages/hardhat/deploy/` (snake_case filename is the SE-2 convention):

- `00_deploy_your_contract.ts` — SE-2 boilerplate, removable.
- `01_deploy_tabcoin.ts`
- `02_deploy_conditional_tokens.ts`
- `03_deploy_prediction_market_v2.ts`
- `04_deploy_position_wrapper.ts` (impl for clones)
- `05_deploy_position_wrapper_factory.ts`
- `06_seed_accounts.ts` — mints TAB to local Hardhat test wallets so anyone running locally has funds.
- `07_deploy_tab_clob.ts`

Run: `yarn deploy` (local) or `yarn deploy --network baseSepolia` (env-gated).

After deploy, ABIs auto-sync into `packages/nextjs/contracts/deployedContracts.ts` via `scripts/generateTsAbis.ts`. The production frontend (`apps/web/`) reads from `packages/shared/src/abis/` and `packages/shared/src/addresses/<chain>.json` — keep those in sync if you regenerate.

For Base Sepolia: `yarn verify --network baseSepolia`.

## Don'ts

- No upgradable proxies. Hackathon scope — we redeploy if we screw up.
- No tokenomics / fee splits beyond a flat AMM fee. Out of scope.
- No real UMA oracle. Resolution is admin-only for the hackathon.
- No mainnet deployment.
