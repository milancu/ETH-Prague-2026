---
name: audit-bet
description: Bezpečnostní audit kontraktů PredictionMarket.sol, TABcoin.sol, PredictionToken.sol a pool.sol. Pokrývá reentrancy, access control, integer aritmetiku, ERC20 edge-cases a ekonomické útoky specifické pro predikční trhy. Vyvolej před každým mergem do main, který sahá na contracts/, a vždy před deployem na testnet/mainnet.
allowed-tools: Read, Grep, Glob, Bash(yarn hardhat:*)
---

# Audit PredictionMarket

Projdi kontrakty v `packages/hardhat/contracts/` a zkontroluj následující kategorie. Ke každému zjištění uveď `file:line` a konkrétní fix (ne jen popis problému).

## 1. Reentrancy

Funkce, které musí mít `nonReentrant` modifier nebo dodržovat checks-effects-interactions:
- `PredictionMarket.fundBet` — má (ověř, že je první v signatuře a že `_betId` validace je před external call)
- `PredictionMarket.redeem` — má (ověř pořadí: burn tokenu → state update → TABcoin transfer)
- `PredictionMarket.resolveBet` — **nemá `nonReentrant`** — pokud zavolá hook, oracle nebo emituje skrz tržní kontrakt, je to vektor

Zvlášť kontroluj:
- `mint`/`burnFrom` na `PredictionToken` — pokud token implementuje `_beforeTokenTransfer` hook, může reentrnout zpět do `PredictionMarket`
- TABcoin `transferFrom` — pokud bys někdy přidal fee-on-transfer logiku, allowance race

## 2. Access control

Pro každou state-modifying externí funkci urči, kdo ji smí volat:
- `createBet` — kdokoli? Měl by být DOS limit (max počet betů per user / minimální TABcoin stake)?
- `resolveBet` — **kritické** — zkontroluj, že má `onlyOwner` / `onlyOracle` / nějakou autorizaci. Bez ní = volné peníze pro kohokoli.
- `TABcoin.mint` — jen owner / minter role
- `PredictionToken.initialize` — jen factory (PredictionMarket), idempotentně chráněno proti dvojí inicializaci

## 3. Integer aritmetika a bounds

- `resolveBet(uint256 outcome1e18)` — **musí** revertovat při `outcome1e18 > 1e18`. Bez toho jsou payouty rozbité.
- Payouty v `redeem` — kontrola dělení nulou (totalSupply yes/no tokenu == 0)
- Pool ratio v `pool.sol` — overflow při násobení velkých čísel (Solidity 0.8 reverte, ale stejně si projdi)

## 4. ERC20 edge cases

- **Návratové hodnoty** TABcoin `transfer`/`transferFrom` — pokud TABcoin sám vrací bool, používáš `SafeERC20` nebo kontroluješ návratovou hodnotu? Tichá failure = ztracené peníze.
- **Fee-on-transfer / rebasing** tokeny — pokud má TABcoin být obecný kolaterál (ne jen tvůj), kontrakt musí měřit *přijatou* částku (`balanceAfter - balanceBefore`), ne `amount` z volání.
- **Self-transfer** v `redeem` — pokud user a kontrakt jsou totéž, nestane se nic divného?
- **Approve race** — pokud někde používáš pattern „approve(0) → approve(N)", OK; jinak pozor na frontrun.

## 5. Ekonomické útoky specifické pro prediction markets

- **Last-bet sniping** — útočník čeká na okamžik před `resolveBet`, pak fundBet velkou částkou na jistou stranu. Existuje cutoff timestamp? Měl by.
- **Oracle manipulation** — pokud `resolveBet` čte z Uniswap V3 poolu (vidím MockUniswapV3Factory + pool.sol), použij TWAP, ne spot. Spot price = flash loan attack.
- **Resolve-front-run** — pokud `outcome1e18` jde na chain skrz veřejnou tx, mempool watcher vidí výsledek a stihne `fundBet` → `redeem` v jednom bloku. Mitigace: commit-reveal, nebo `fundBet` zakázat po určitém timestampu.
- **Toxic liquidity** — TABcoin pool může být manipulovaný, pokud je market maker zároveň protistrana.
- **Dust griefing** — vytváření milionů malých betů, které DOSnou getter funkce.

## 6. Specifické pro tenhle projekt

- `PredictionToken` se inicializuje per bet — kontrola: nelze zavolat `initialize` dvakrát? `market_` parametr odpovídá `msg.sender` factory?
- `_toString(uint256)` — interní pure funkce, OK; ale ověř, že není použit pro nic security-citlivého (typicky generování symbolu tokenu)
- `MockUniswapV3Factory` — **pozor**: pokud je v deploy skriptech pro testnet/mainnet a ne jen pro testy, máš falešné TWAP

## Výstup

Vrať strukturovaně:
1. **Critical** (peníze v ohrožení) — `file:line`, popis, fix
2. **High** (logická chyba bez okamžité ztráty) — to samé
3. **Medium** (gas/UX/best practice) — kompaktně
4. **Co je v pořádku** — krátký bullet list, ať vidím, co jsi zkontroloval

Pokud jsou v `packages/hardhat/test/` testy, pusť je (`yarn hardhat:test`) a uveď, které z tvých zjištění mají test coverage a které ne.
