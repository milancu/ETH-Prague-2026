# apps/web — CLAUDE.md

Frontend rules. Read the root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/constitution.md`](../../docs/constitution.md) first.

## Stack (constitution-locked)

- Vite + React 19 + TypeScript.
- **Tailwind only.** No `.css` files except `index.css` for the Tailwind directives. No CSS-in-JS.
- **shadcn/ui** for primitives. If a primitive does not exist in shadcn, generate it via the CLI before hand-rolling.
- **wagmi v2 + viem + RainbowKit.** Direct `ethers` or `window.ethereum` is forbidden.
- React state hooks for UI state. wagmi/React Query for chain and server data. **No Redux.**

## Conventions

- Folder layout: `src/components/`, `src/pages/`, `src/hooks/`, `src/lib/`, `src/abis/` (re-exported from `packages/shared`), `src/config/`.
- Components: PascalCase files, default export.
- Hooks: `useFooBar`, camelCase, named export.
- Tailwind classes ordered: layout → spacing → sizing → typography → color → state. Use `cn()` from `lib/utils.ts` (shadcn standard) to merge.
- Mobile-first. Default styles are mobile, `sm:` and up scale up.

## Web3 patterns

- Always `useSimulateContract` before `useWriteContract`. If simulation fails, the button is disabled with the revert reason in a tooltip.
- Always invalidate queries after a confirmed tx (`queryClient.invalidateQueries`).
- Token approvals: split into `approve` and `action` steps, reflect each in the UI with toasts.
- Chain IDs and contract addresses come from `packages/shared/src/addresses/<chain>.json`. Never hardcode.

## AI Transaction Card validation (mandatory)

Before passing an AI-proposed transaction to wagmi:

1. Validate the payload against `TransactionCardSchema` from `packages/shared`.
2. Confirm `to` matches a known contract for the current `chainId` (address book lookup).
3. Confirm `functionName` is in the allow-list for that contract.
4. Confirm TAB amount is non-zero and within the user's balance.
5. Run `useSimulateContract`. If it reverts, refuse.

If any step fails, render the card in a disabled error state. **Never** sign an AI payload that has not passed all five checks.

## Testing

- Tests only for non-trivial pure logic: `useOddsFormatter`, AI card validator, market schema. Vitest.
- No tests for JSX rendering, no Storybook, no Playwright. Save the time.

## Don'ts

- No `any` in checked-in code. `unknown` + a type guard, or define the type.
- No new top-level dependencies without listing them in the PR description with a one-line justification.
- No raw `fetch` to chain RPCs. Use viem.
- No raw `fetch` to the LLM provider. Use `apps/api`.
