---
name: check-0x
description: Guided plán pro přidání 0x Protocol integrace (Swap API / Permit2). V projektu zatím 0x není (`grep` v `apps/web/`, `apps/api/`, `apps/contracts/packages/nextjs/` vrací 0). Pokud začneš integrovat, vyvolej tento skill — provede tě architektonickými volbami (v1 vs v2, quote-only vs swap, zdroj likvidity) a po implementaci přepne do audit módu (slippage, allowance, signature replay, gas budget). Local Hardhat forkuje Base mainnet, takže 0x ExchangeProxy + reálné poolíky jsou v lokálním dev dostupné.
allowed-tools: Read, Grep, Glob, WebFetch
---

# 0x integration — guided plan + audit

## Krok 1 — najdi, jestli 0x integrace už existuje

Hledej v repu:

```bash
grep -rn "0x\.org\|0xapi\|api\.0x\.org\|@0x/\|exchangeProxy\|allowanceTarget\|permit2\|0xQuote" \
  apps/web/ apps/api/ apps/contracts/packages/nextjs/ \
  --include="*.ts" --include="*.tsx" --include="*.py" --include="*.sol" \
  2>/dev/null | grep -v node_modules
```

- **0 hitů** → integrace zatím není. Přejdi na **Sekci A**.
- **Hits jen v hex literálech** typu `0x1234...` (Ethereum addresses) → falešný pozitiv, integrace není. Sekce A.
- **Reálné `api.0x.org` reference** → integrace už je. Sekce B.

## Sekce A — Plán pro přidání 0x integrace

Než cokoli kódíš, **zeptej se uživatele** přes `AskUserQuestion`:

### Q1. Use case
- **Quote-only** (display ceny v UI, žádný swap) — frontend-only, žádný backend / kontrakt nepotřebuješ
- **Skutečný swap** — nutný buď MetaMask `eth_sendTransaction` přes `quote.to` + `quote.data`, nebo Permit2 signature flow

### Q2. Která API verze?
- **0x Swap API v1** (`/swap/v1/quote`) — exchangeProxy + allowanceTarget pattern. Starší, jednodušší. Stále široce podporované.
- **0x Swap API v2** (`/swap/permit2/quote`) — Permit2 pattern (Uniswap), gas-efficient (single approve to Permit2), ale UX má signaturu navíc.
- Doporučení: pokud nemáš důvod pro v1, jdi rovnou v2. Modernější, lepší gas, méně "approve" UX.

### Q3. Source / target assets
Konkrétně: TAB → ETH? TAB → USDC? Nebo opačně? Něco jiného?

**Pozor:** TABcoin je deployovaný jen na Base Sepolia (per `apps/contracts/packages/hardhat/deploy/01_deploy_tabcoin.ts`) v této instalaci. Na Base mainnet ani jinde nikdo TABcoinu nemá → 0x nenajde žádné poolíky pro TAB-jakýkoliv-pár. **Pro reálný 0x swap potřebuješ jeden ze dvou**:
- (a) TAB pár existuje na Base mainnet (musel by jít deploy + provided liquidity z týmu) — málo pravděpodobné v hackathonu.
- (b) Swap se týká **jiného** assetu, ne TAB. Třeba: ETH → USDC v rámci platformy (např. user platí gas v USDC). Pak 0x dává smysl.

Pokud uživatel chce TAB ↔ ETH/USDC swap a TAB existuje jen na Base Sepolia, **zastav se**. Vysvětli, že 0x na Base Sepolii má omezenou likviditu (testnet pooly bývají téměř prázdné). Lepší cesta:
- Pro hackathon demo: udělej **mock 0x quote endpoint** v `apps/api/`, který vrací deterministickou cenu (např. 1 TAB = 0.001 ETH). Frontend volá tvůj endpoint ve stejném tvaru jako 0x.
- Pro produkci: deploy TAB na Base mainnet + seed liquidity → integrace 0x v2 → reálné quotes.

### Q4. Chain
- Local Hardhat forkuje Base mainnet (`forking.url = BASE_FORK_URL || base-mainnet alchemy` v `hardhat.config.ts`). 0x ExchangeProxy + WETH + reálné poolíky **jsou** v lokálním dev fork dostupné, takže můžeš 0x volat lokálně proti reálnému stavu Base.
- Base Sepolia (testnet, primární deploy cíl projektu) — 0x má omezenou podporu, předpoklad: skoro žádná likvidita pro custom tokeny.
- Base mainnet — reálné, ale projekt zatím není na mainnetu.

### Q5. API key / billing
- 0x volá s headerem `0x-api-key`. Public rate-limited tier je zdarma, ale slabý.
- Paid tier = klíč citlivý → **nikdy do `NEXT_PUBLIC_*` nebo `VITE_*`**. Server-side proxy v `apps/api/`.
- Pro hackathon stačí free tier.

Vrať tyto otázky uživateli **přes `AskUserQuestion`** (jedna otázka per téma, max 4 v batch). Bez odpovědí nepiš kód.

### Až máš odpovědi, navrhni minimální skeleton

Volby (pick one):

**A) Quote-only ve frontendu**
- `apps/web/src/services/0x.ts` — fetch utility
- `apps/web/src/hooks/useSwapQuote.ts` — TanStack Query wrapper
- API key v `VITE_0X_API_KEY` (jen pokud public tier)

**B) Quote přes backend proxy (paid key)**
- `apps/api/src/api/routes/swap.py` — endpoint `GET /api/v1/swap/quote?sellToken=...&buyToken=...&sellAmount=...`
- 0x klíč v `apps/api/.env` jako `ZERO_X_API_KEY` (server-side, nikdy do frontend bundlu)
- Frontend volá tvůj endpoint, ne 0x přímo

**C) On-chain swap (full)**
- B + frontend `useSwapTransaction` hook
- Allowance flow:
  - **v1:** `tabcoin.approve(quote.allowanceTarget, amount)` → `wagmi.useWriteContract` na `quote.to` s `quote.data`
  - **v2:** signovat Permit2 (`useSignTypedData`) → `quote.to` s permit signaturou v `data`

### Bezpečnostní pravidla pro on-chain swap

- **Allowlist `quote.allowanceTarget`** podle `chainId`. Pokud 0x DNS kompromitovaný, vrátí malicious adresu. Hardcoduj známé exchangeProxy / Permit2 addresses pro každý supported chain.
- **Slippage default:** 1% (`slippagePercentage=0.01`). Nikdy víc než 5% bez explicitního UI varování.
- **Buyer protection:** `quote.guaranteedPrice` použij jako `minOutput` na on-chain straně. Pokud máš router smart contract, `require(amountOut >= minOutput)`.
- **Gas budget:** `quote.estimatedGas * 1.2` jako safety margin.
- **Quote freshness:** TTL 0x quote ~15s. Re-fetch těsně před `sendTransaction`, nepoužívat minutu starý quote.
- **Re-validate před sign:** `quote.to`, `quote.value`, `quote.data` musí být ze stejného fetch volání jako displayed price.

## Sekce B — Audit existující integrace

Pro každý nalezený call-site:

### Quote fetching
- API key — server-side (apps/api proxy) nebo `VITE_*` (= veřejný)? Pokud paid tier, **musí** být server-side.
- `chainId` v query — předáván správně? Hardcoded chainId = bug při switch network.
- Error handling pro 4xx/5xx z 0x — handluješ je nebo se app rozsype?
- Cache — pokud cachuješ quote déle než 30s, ceny jsou stale.

### Allowance flow
- Před swapem: `allowance >= sellAmount`? Pokud ne, `approve(allowanceTarget, sellAmount)` — nikdy `approve(..., uint256.max)` bez explicitního UI souhlasu.
- Permit2 (v2): podpis ve správném `domainSeparator`u? `nonce` se zvyšuje? `deadline` < 30 minut?

### Swap execution
- `tx.to` se přesně rovná `quote.to` z fresh fetchnutého quote? (Re-fetch těsně před `sendTransaction`.)
- `tx.value === quote.value`? Pro ETH→token swap je `value = sellAmount`; pro token→token = 0.
- Po swap: ověření, že user dostal alespoň `quote.guaranteedPrice * sellAmount`. Pokud máš router smart contract, zabudovat `require(amountOut >= minOutput)`.

### Frontend UX
- Loading state mezi quote fetch a tx submit — user nevidí stale cenu?
- „Quote expires in N seconds" countdown.
- Error handling: insufficient liquidity, insufficient allowance, user rejection, paused trading, API rate limit.

### Když narazíš na cokoli neobvyklého
- Použij `WebFetch` na `https://0x.org/docs/api` k ověření aktuálního API tvaru. **Nehádej** parametry/endpointy z paměti — 0x API se mění.

## Výstup

Vrať uživateli:

1. **Kategorie:** „Integrace neexistuje — plán" / „Integrace existuje — N findings"
2. **Findings** seřazené podle severity (peníze → bezpečnost → UX → gas/best practice)
3. **Open questions** k uživateli, pokud něco není zřejmé z kódu / konfigurace

Pokud jsi spustil grep a našel jsi jen falešné pozitivy (typu hex addresses `0x1234...` v deployedContracts.ts), explicitně řekni: „V repu zatím není 0x integrace — našel jsem jen hex literály v address bookech." A přejdi na Sekci A.
