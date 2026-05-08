---
name: audit-bet
description: Bezpečnostní audit kontraktů PredictionMarketV2.sol, ConditionalTokens.sol, TABcoin.sol, TabClob.sol, PositionWrapper(Factory).sol. Pokrývá reentrancy, access control, integer aritmetiku, ERC20/ERC1155 edge-cases a ekonomické útoky specifické pro predikční trhy + EIP-712 CLOB. Vyvolej před každým mergem do main, který sahá na contracts/, a vždy před deployem na testnet/mainnet.
allowed-tools: Read, Grep, Glob, Bash(yarn:*), Bash(npx hardhat:*)
---

# Audit PredictionMarketV2 + souvisí kontrakty

Projdi kontrakty v `apps/contracts/packages/hardhat/contracts/` a zkontroluj následující kategorie. Ke každému zjištění uveď `file:line` a konkrétní fix (ne jen popis problému).

**Reálná architektura projektu** (ověř ji `find` před auditem, mohlo se to mezitím změnit):
- `TABcoin.sol` — ERC-20 (`TAB`), burnable, hardcoded `AUTHORIZER = 0x48c5632dCC220Abf56000F93B1C4DEB501c64588` mintuje a uděluje claim allowances.
- `ConditionalTokens.sol` — Gnosis-CTF-kompatibilní ERC-1155, bez nested conditions, binary/multi/scalar/ordinal outcomes.
- `PredictionMarketV2.sol` — lifecycle + curation + bond, registrovaný jako `oracle` pro každý market (per-market `oracle` je auth pro `resolveMarket`).
- `PositionWrapper.sol` + `PositionWrapperFactory.sol` — `Clones`-based ERC-1155 → ERC-20 wrappery per `(collateral, conditionId, indexSet)`.
- `TabClob.sol` — EIP-712 ERC-20 limit order book, off-chain podpisy, on-chain `fill`. Používá `SignatureChecker` (ECDSA + EIP-1271).

## 1. Reentrancy

Funkce, které **musí** mít `nonReentrant` (a/nebo dodržovat checks-effects-interactions):

- `PredictionMarketV2.createMarket` — zkontroluj že má `nonReentrant`. Volá `IERC20(collateral).safeTransferFrom` (bond) + `IConditionalTokens.prepareCondition`.
- `PredictionMarketV2.cancelMarket` — má (line ~170). Vrací bond, ověř pořadí: state update → external transfer.
- `PredictionMarketV2.slashCreatorBond` — má (line ~238). `onlyCurator nonReentrant`. Posílá bond na `treasury`.
- `PredictionMarketV2.claimCreatorBond` — má (line ~247). Pošle bond zpět creatorovi po `resolved`.
- `PredictionMarketV2.resolveMarket` — má (line ~263). Volá `IConditionalTokens.reportPayouts`. CT sám pak pouští `PayoutRedemption` při `redeemPositions`.
- `ConditionalTokens.splitPosition` / `mergePositions` / `redeemPositions` — všechny musí mít `nonReentrant` (volají `safeTransferFrom` na collateral). Ověř.
- `TabClob.fill` — má (line ~75). Volá dvě `safeTransferFrom`. Pořadí: `_filled[hash] = true` PŘED transfery. Re-check.
- `PositionWrapper.wrap` / `unwrap` — kontrolují ERC-1155 callbacks. Ověř, že nemůžou re-enter zpátky a vyrobit dvojí mint/burn ERC-20.

Zvlášť kontroluj:
- `IERC1155Receiver` callbacks (`onERC1155Received`, `onERC1155BatchReceived`) na `PositionWrapper` — pokud ne-bezpečně updatují stav, je to vektor.
- `safeTransferFrom` na ERC-1155 callbackuje recipient → pokud `PositionWrapper` přijímá tokeny od neznámé adresy, ujisti se, že stav je už final.

## 2. Access control

Pro každou state-modifying externí funkci ověř, kdo ji smí volat:

- **`PredictionMarketV2.resolveMarket`** — `require(msg.sender == m.oracle)`. **Per-market** oracle, ne globální admin. Ověř, že `oracle` se nedá podstrčit při `createMarket` a měnit potom.
- **`PredictionMarketV2.verifyMarket`** — `onlyCurator`.
- **`PredictionMarketV2.slashCreatorBond`** — `onlyCurator`.
- **`PredictionMarketV2.pauseMarket` / `resumeMarket`** — `onlyGovernance`.
- **`PredictionMarketV2.transferCurator` / `transferGovernance` / `setTreasury`** — `onlyGovernance`. Ověř, že nelze `transferGovernance(address(0))` (lock-out) — kontrakt to má řešit `require(next != address(0))`.
- **`PredictionMarketV2.extendMarket`** — creator OR curator. Zkontroluj, že nedovoluje zkrátit (`newExpiresAt >= m.expiresAt`).
- **`PredictionMarketV2.cancelMarket`** — creator (do `creatorCancelWindow`) OR curator (kdykoli).
- **`TABcoin.mint` / `authorizeClaim` / `revokeClaim`** — `onlyAuthorizer`. AUTHORIZER je hardcoded constant: `0x48c5632dCC220Abf56000F93B1C4DEB501c64588`. **Ověř že tato adresa je opravdu řízená týmem** — pokud ne, někdo jiný může volně mintit TAB. Není to test address?
- **`ConditionalTokens.reportPayouts`** — kontrolovat, že `msg.sender == condition.oracle`. CT je registrovaný PMv2 jako oracle, takže reálně volá PMv2 přes `resolveMarket`.

## 3. Integer aritmetika a bounds

- `ConditionalTokens.reportPayouts(payouts)` — suma `payouts[i]` musí být >0 (jinak division by zero v `redeemPositions`). Ověř.
- `ConditionalTokens.redeemPositions` — payout = `balance * payoutNumerators[i] / payoutDenominator`. Pokud `payoutDenominator == 0`, revert. Pokud jednotlivé `payoutNumerators[i]` overflow při násobení s `balance`... Solidity 0.8 reverte, ale nahlas to.
- `TabClob.fill` — `makerAmount * takerAmount` v partial-fill logice (pokud existuje). V této verzi je to atomická whole-order, takže overflow risk minimální, ale ověř že `Order.makerAmount > 0 && takerAmount > 0`.
- `PredictionMarketV2.createMarket(outcomeSlotCount)` — `require(outcomeSlotCount >= 2 && outcomeSlotCount <= MAX)` (ať MAX není absurdní, např. <= 256).
- `PositionWrapper.wrap` / `unwrap` — ERC-20 mint/burn 1:1 s ERC-1155 balance. Žádné fees, ověř.

## 4. ERC20 / ERC1155 edge cases

- **TABcoin** používá vanilkový OpenZeppelin `ERC20` — vrací bool, ale OZ implementace nikdy nevrátí false (revertuje). Ostatní kontrakty by stejně měly používat **`SafeERC20`** všude — ověř (PMv2 to dělá).
- **Fee-on-transfer / rebasing** — pokud kdokoli později nahradí TABcoin za jiný ERC-20, kontrakty se rozbijou. Ověř, že rozhraní jasně předpokládají non-fee, non-rebasing token. Dokumentuj.
- **Self-transfer** v `claimCreatorBond` — pokud `creator == treasury == kontrakt`, divné? Asi NA, ale stojí za bullet.
- **Approve race** — TABcoin je vanilkový OZ ERC-20, má klasický approve, žádný `increaseAllowance`. Pokud frontend pattern `approve(0) → approve(N)`, OK; jinak race (užív Permit2 ve full release).
- **ERC-1155 batch transfers** — `PositionWrapper` dostává jen single-token transfers (jeden `positionId` per wrapper). Batch by měl revertnout, nebo bezpečně handlovat. Ověř `onERC1155BatchReceived`.

## 5. Ekonomické útoky specifické pro prediction markets + CLOB

- **Resolve front-run** — `resolveMarket(payouts)` jde do mempoolu. Útočník vidí výsledek a stihne `TabClob.fill` na výherní side levně, pak redeem. Mitigace: před resolve nastavit `paused`, nebo časový buffer mezi `expiresAt` a `resolutionTime`.
- **Oracle griefing** — per-market `oracle` může nastavit libovolný outcome. Pokud uživatelé nevěří oracle, market je špatný. Doporučení: `verifyMarket` od curator-a by měl ověřit i důvěryhodnost oracle.
- **Bond slashing edge cases** — co když creator stihne `claimCreatorBond` před tím, než curator zavolá `slashCreatorBond`? `bondClaimed` flag musí blokovat `slashCreatorBond` a vice versa (kontrakt to dělá řádkou ~240).
- **EIP-712 signature replay** v TabClob — ověř `DOMAIN_SEPARATOR` zahrnuje `chainId`. OZ `EIP712` recomputuje, ale je tam i `salt` v Order? Ano (`Order.salt`). Plus `expiry`. Plus internal `_filled[orderHash]` mapping. Ověř všechny tři chrání proti replay (across chains, across blocks po fill, dvojitý fill).
- **Full-set arbitrage** — Pokud cena Yes + cena No na TabClob < 1 TAB (full set hodnota), arb-bot může koupit obě, mergePositions, a redeem 1 TAB → zisk. To je **fíčura** AMM/CLOB market makingu, ne bug. Ale dokumentuj že market makers musí kvotovat tak, aby suma byla > 1.
- **Wrapper griefing** — `getOrCreateWrapper` je idempotentní. Útočník nemůže "ukrást" budoucí wrapper adresu, protože je deterministicky odvozená z `(collateral, conditionId, indexSet)`. Ověř.
- **Dust griefing** — vytváření milionů malých marketů, které DOSnou getter funkce (např. enumerace). Pokud PMv2 enumerator je on-chain (ne backend indexer), problém. Pokud jen backend indexer čte události, OK.

## 6. Specifické pro tenhle projekt

- `TABcoin.AUTHORIZER` — hardcoded address `0x48c5632dCC220Abf56000F93B1C4DEB501c64588`. **Kdo má privát klíč?** Pokud nikdo (test address bez private key na produkci), kontrakt nikdy nevyemituje žádné TAB → mrtvý. Pokud má klíč jeden člen týmu, je to single point of failure. Pokud byla kompromitovaná, někdo cizí může mintit nekonečno. Ověř.
- `PositionWrapperFactory.getOrCreateWrapper` — používá `Clones.cloneDeterministic`. Salt je `key(collateral, conditionId, indexSet)`. `PositionWrapper.initialize` musí být idempotentní (revert při druhém volání). Ověř.
- `PositionWrapper.initialize` — ověř, že má `require(ct == address(0), "already initialized")` nebo OZ `Initializable` modifier `initializer`.
- Pokud máš UpgradeableSafeERC20 — doplň upgrade safety checks.

## 7. Spuštění existujících testů

Pokud existují testy v `apps/contracts/packages/hardhat/test/`:

```bash
cd apps/contracts/packages/hardhat && yarn test
```

Vyhodnoť pokrytí: které z tvých zjištění mají test (a které ne).

## Výstup

Vrať strukturovaně:
1. **Critical** (peníze v ohrožení) — `file:line`, popis, fix
2. **High** (logická chyba bez okamžité ztráty) — to samé
3. **Medium** (gas/UX/best practice) — kompaktně
4. **Low / informational** — jednořádkově
5. **Co je v pořádku** — krátký bullet list, ať vidím, co jsi zkontroloval

Pokud cokoli neprojdeš (chybí ti přístup, nejsi si jistý), explicitně to napiš místo aby ses tvářil že máš pokrytí 100 %.
