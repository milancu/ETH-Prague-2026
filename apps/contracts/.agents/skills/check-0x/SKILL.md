---
name: check-0x
description: Review 0x Protocol integrace (Swap API / Permit2). Pokud integrace ještě neexistuje, vrátí guided plán pro její přidání. Pokud existuje, audituje slippage, allowance flow, fallback na revert, gas budget a správné použití chain-specific endpointů. Vyvolej, kdykoli sahneš na 0x quote/swap kód, nebo plánuješ swap z TABcoinu na ETH/USDC.
allowed-tools: Read, Grep, Glob, WebFetch
---

# 0x integration review

## Krok 1 — najdi, jestli 0x integrace existuje

Hledej v repu:

```
grep -rn "0x.org\|0xapi\|api.0x.org\|@0x/\|exchangeProxy\|allowanceTarget\|permit2\|0xQuote" \
  packages/nextjs/ packages/hardhat/ \
  --include="*.ts" --include="*.tsx" --include="*.sol"
```

Pokud nic nenajdeš → integrace zatím není. Přejdi na **Sekci A**.
Pokud něco najdeš → přejdi na **Sekci B**.

---

## Sekce A — Plán pro přidání 0x integrace

Než cokoli kódíš, **zeptej se uživatele**:

1. **Která verze API?**
   - **0x Swap API v1** (`/swap/v1/quote`) — starší, jednodušší, exchangeProxy + allowanceTarget pattern
   - **0x Swap API v2** (`/swap/permit2/quote`) — novější, používá Permit2 (Uniswap), gas-efficient, ale složitější UX (signatura)
   - Doporučení: pokud máš > Q2 2025 projekt, jdi rovnou v2.
2. **Side: on-chain swap nebo jen quote pro display?**
   - Quote-only (display ceny) — frontend-only, žádný kontrakt nepotřebuješ
   - Skutečný swap — kontrakt musí approve allowanceTarget a poslat calldata
3. **Source assets:**
   - Z čeho na co se má swapovat? TABcoin → ETH? TABcoin → USDC?
   - Existuje vůbec likvidita pro TABcoin na 0x na cílovém chainu? Zkontroluj `https://api.0x.org/swap/v1/sources?chainId=11155111` (Sepolia) — pravděpodobně skoro nic. Mainnet je realističtější.
4. **Chain:**
   - Sepolia má **omezenou** 0x podporu. Pro reálný vývoj: Base, Polygon, Mainnet, Arbitrum.
   - Ověř na `https://0x.org/docs/introduction/0x-cheat-sheet` (nehádej endpointy).

Vrať tyto otázky uživateli **jako AskUserQuestion** (pokud máš tool) nebo jasným seznamem. Bez odpovědí nepiš kód.

### Až máš odpovědi, navrhni minimální skeleton:

- Kde quote fetchovat: typicky `packages/nextjs/services/0x.ts` (utility) volaný z hooku `usePriceQuote`.
- API key: 0x vyžaduje header `0x-api-key`. Ulož do `.env.local` jako `NEXT_PUBLIC_0X_API_KEY` **jen pokud** API key není citlivý (rate-limited public key OK; paid key NE — pak server-side proxy v `app/api/0x/quote/route.ts`).
- Allowance flow:
  - v1: `tabcoin.approve(allowanceTarget, amount)` → `signer.sendTransaction({ to: quote.to, data: quote.data, value: quote.value })`
  - v2: signovat Permit2, posílat na `permit2.to` s permit signaturou v `data`

### Bezpečnostní pravidla pro on-chain swap

- **Vždy** kontroluj `quote.allowanceTarget` proti **allowlistu adres pro daný chainId**. 0x kompromitovaný DNS by mohl vrátit malicious adresu.
- Slippage default: 1% (`slippagePercentage=0.01`). Nikdy ne víc než 5% bez explicitního UI varování.
- `expectedPrice` z quote vs. on-chain `getAmountOut` z Uniswap V3 (máš pool.sol) — pokud se liší o > 3%, refuse.
- Buyer protection: `quote.guaranteedPrice` použij jako `minOutput` na on-chain straně; pokud reálný output je nižší, tx revertuje.
- Gas budget: `quote.estimatedGas * 1.2` jako safety margin.

---

## Sekce B — Audit existující integrace

Pro každý nalezený call-site:

### Quote fetching
- Je API key skrytý za server-side route, nebo je v `NEXT_PUBLIC_*` (= veřejný)? Pokud paid tier, **musí** být server-side.
- Je chainId předáván správně do query stringu? Hardcoded chainId = bug při switch network.
- Chyby z 0x (4xx, 5xx) — handluješ je nebo se aplikace rozsype?
- Cache: pokud cachuješ quote déle než 30s, ceny jsou stale.

### Allowance flow
- Před swapem: `allowance >= sellAmount`? Pokud ne, `approve(allowanceTarget, sellAmount)` — nikdy `approve(..., uint256.max)` bez explicitního UI souhlasu uživatele.
- Permit2 (v2): podpis signovaný správným domainSeparatorem? `nonce` se zvyšuje? `deadline` < 30 minut?

### Swap execution
- `tx.to` se přesně rovná `quote.to` z fresh fetchnutého quote? (Re-fetch těsně před `sendTransaction`, ne použít minutu starý quote.)
- `tx.value === quote.value`? Pro ETH→token swap je value = sellAmount; pro token→token = 0.
- Po swap: ověření, že user dostal alespoň `quote.guaranteedPrice * sellAmount`. Pokud používáš router smart contract na své straně, zabudovat `require(amountOut >= minOutput)`.

### Frontend UX
- Loading state mezi quote fetch a tx submit — user nevidí stale cenu?
- „Quote expires in N seconds" countdown — 0x quote má TTL ~15s.
- Error handling pro insufficient liquidity, insufficient allowance, user rejection.

### Když narazíš na cokoli neobvyklého
- Použij `WebFetch` na `https://0x.org/docs/api` k ověření aktuálního API tvaru. **Nehádej** parametry/endpointy z paměti — 0x API se mění.

---

## Výstup

Vrať uživateli:

1. **Kategorie:** „Integrace neexistuje — plán" / „Integrace existuje — N findings"
2. **Findings** seřazené podle severity (peníze → bezpečnost → UX)
3. **Open questions** k uživateli, pokud něco není zřejmé z kódu

Pokud jsi spustil grep a našel jsi jen falešné pozitivy (typu hex addresses `0x1234...`), explicitně řekni: „V repu zatím není 0x integrace — našel jsem jen hex literály." A přejdi na Sekci A.
