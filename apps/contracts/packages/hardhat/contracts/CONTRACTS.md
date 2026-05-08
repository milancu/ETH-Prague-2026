# Smart Contracts — hloubková dokumentace

Tento dokument popisuje **každý produkčně použitý kontrakt** v repu, jejich vzájemné vztahy, datové struktury, vstupní/výstupní toky, autentizační model a bezpečnostní úvahy.

> Verze: V2 stack (post-migrace).
> Solidity: `^0.8.24` (PredictionMarket stack), `>=0.8.0 <0.9.0` (legacy `YourContract`).
> Závislosti: OpenZeppelin Contracts + OpenZeppelin Contracts-Upgradeable (pro `PositionWrapper`).

---

## 0. Architektonický přehled

```
                ┌─────────────────────────┐
                │       TABcoin (ERC20)   │  collateral + bond token
                └────────────┬────────────┘
                             │ approve / transferFrom
                             ▼
┌──────────────────────┐   reportPayouts   ┌────────────────────────┐
│  PredictionMarketV2  │ ────────────────▶ │   ConditionalTokens    │
│  (lifecycle, bonds,  │  prepareCondition │   (ERC-1155 CTF lite)  │
│   curation, oracle)  │ ◀──────────────── │                        │
└──────────────────────┘                   └───────────┬────────────┘
                                                       │ split / merge / redeem
                                                       │ (ERC-1155 mint/burn)
                                                       ▼
                                          ┌────────────────────────┐
                                          │  PositionWrapper(ERC20)│  1:1 obal nad
                                          │  ── via Clones ───────▶│  konkrétní position
                                          │  PositionWrapperFactory│  (ID = uint256)
                                          └────────────────────────┘
```

**Hlavní idea:**
- `ConditionalTokens` je nízkoúrovňová ERC-1155 vrstva (Gnosis CTF lite, bez vnořených podmínek). Drží kolaterál a vydává/spaluje pozice.
- `PredictionMarketV2` sedí nad CT jako *registrovaný oracle pro každý market* a přidává: životní cyklus marketu, kurátorský bond, governance, multi-typ outcome (BINARY / MULTI / SCALAR / ORDINAL).
- `PositionWrapper` + `PositionWrapperFactory` umožňují uživatelům převést ERC-1155 pozici na fungovatelný ERC-20 token (1:1) — pro orderbook, AMM, transfery, kompozici s DeFi.
- `TABcoin` je vlastní ERC-20 sloužící jako kolaterál a bond token; má claim-allowance mechaniku ovládanou napevno zadrátovaným *authorizerem*.

**Co _není_ na chainu:**
- AMM/orderbook logika (řeší se off-chain / na jiných kontraktech).
- Pricing pozic (closed-form je delegováno na frontend / pool helpery).

---

## 1. `ConditionalTokens.sol`

Vlastní lehká implementace Gnosis Conditional Token Framework.

### 1.1 Účel
Drží kolaterál a vydává **ERC-1155 pozice** odpovídající podmnožinám outcome slotů (`indexSet`). Bez nested conditions — *parent collection ID* je v této implementaci vždy implicitně 0, takže `collectionId = keccak256(conditionId, indexSet)` a `positionId = keccak256(collateral, collectionId)`.

### 1.2 Storage

```solidity
struct Condition {
    address oracle;             // adresa, která smí volat reportPayouts (typicky PredictionMarketV2)
    bytes32 questionId;         // libovolný 32B identifikátor dotazu (PM2 z něj dělá hash z marketId)
    uint256 outcomeSlotCount;   // počet outcome slotů, 2..256
    uint256 payoutDenominator;  // suma payoutNumerators po resolution
    uint256[] payoutNumerators; // payout vector
    bool resolved;              // true po reportPayouts
}
mapping(bytes32 => Condition) private _conditions;
```

ERC-1155 balances drží OZ implementace; rolí kontraktu je je vydávat / pálit a držet kolaterál.

### 1.3 ID helpery (pure)

| Funkce | Vzorec |
|---|---|
| `getConditionId(oracle, questionId, N)` | `keccak256(oracle ‖ questionId ‖ N)` |
| `getCollectionId(conditionId, indexSet)` | `keccak256(conditionId ‖ indexSet)` |
| `getPositionId(collateralToken, collectionId)` | `uint256(keccak256(collateral ‖ collectionId))` |

ID schéma je deterministické a *čisté pure* — frontend i ostatní kontrakty si je můžou počítat off-chain.

### 1.4 Lifecycle

#### `prepareCondition(oracle, questionId, N)`
- Vytvoří podmínku. `oracle ≠ 0`, `2 ≤ N ≤ 256`.
- Idempotence: opakovaná příprava se stejnými parametry **revertuje** (`already prepared`).
- Volá ji typicky `PredictionMarketV2.createMarket` (a tam je oracle = `address(this)` PMv2).

#### `reportPayouts(questionId, payouts)`
- Volá `oracle` (= adresa, pod kterou byl vytvořen `conditionId`).
- `denom = sum(payouts)` — musí být `> 0`. Žádné omezení na rozsah, takže funguje pro:
  - **BINARY** (`[1,0]` / `[0,1]`),
  - **MULTI** (one-hot),
  - **SCALAR** (lineární váhování `[L, H]`),
  - **ORDINAL** (oracle volně rozdělí váhu).
- Idempotence: druhý call po resolution revertuje (`already resolved`).

### 1.5 Token mechanika

| Funkce | Co dělá | Pre-conditions |
|---|---|---|
| `splitPosition(collateral, conditionId, partition[], amount)` | Stáhne `amount` kolaterálu od `msg.sender`, mintne `amount` ERC-1155 pro každý `indexSet` z `partition` | `partition` musí být **kompletní disjunktní rozklad** plné množiny outcome slotů; `amount > 0` |
| `mergePositions(collateral, conditionId, partition[], amount)` | Spálí `amount` všech pozic z `partition` a vrátí `amount` kolaterálu | Funguje **kdykoli, i po resolution** — proto je `merge` cesta zpět ke kolaterálu i pro nevyřízené pozice |
| `redeemPositions(collateral, conditionId, indexSets[])` | Po resolution: spálí všechny držené tokeny z uvedených `indexSets` a vyplatí `balance * payoutNumerator(set) / denom` | `c.resolved == true`; pokud držitel nemá v daném setu balance, set se přeskočí |

**Validace partition** (`_validatePartition`): partition.length ≥ 2, každý set ≠ 0 a ≤ fullIndexSet, sety jsou párově disjunktní (kontrola pomocí XOR/AND), union = fullIndexSet. Tj. plné pokrytí bez překryvu.

`fullIndexSet`:
- pro `N == 256` → `type(uint256).max`,
- jinak → `(1 << N) - 1`.

### 1.6 Reentrancy & bezpečnost
- `splitPosition`, `mergePositions`, `redeemPositions` jsou označené `nonReentrant`.
- Pro kolaterál se používá `SafeERC20` (`safeTransferFrom`, `safeTransfer`) → safe pro non-standard ERC-20 (USDT-like).
- ERC-1155 transferuje `_mintBatch` / `_burnBatch` — pokud by příjemcem byl kontrakt nepodporující ERC-1155, OZ standardně volá `onERC1155BatchReceived`. Při `splitPosition` je příjemcem `msg.sender`; pokud volá smart account, musí implementovat receiver (analogicky `PositionWrapper`).
- **Nestandardní vlastnost vs. plný Gnosis CTF:** chybí parent-collection nesting. Nepokrývá tedy "subdivision" pozic přes víc conditions, ale to je v PM2 designu záměrně OOO scope.

### 1.7 Eventy
`ConditionPreparation`, `ConditionResolution`, `PositionSplit`, `PositionsMerge`, `PayoutRedemption` — frontend je indexuje pro market discovery a UX historii.

---

## 2. `PredictionMarketV2.sol`

Lifecycle + curation + bond layer **nad** `ConditionalTokens`. *Nedrží* uživatelské pozice — všechny token operace (split/merge/redeem) volá uživatel přímo na CT.

### 2.1 Klíčové role

| Role | Pravomoc | Nastavení |
|---|---|---|
| `creator` (per market) | `cancelMarket` v rámci `creatorCancelWindow`, `extendMarket`, `claimCreatorBond` po resolution | implicitně `msg.sender` při `createMarket` |
| `oracle` (per market) | `resolveMarket` (jediná cesta k payoutu) | volitelně předáno do `createMarket` |
| `curator` | `cancelMarket` kdykoli (slashne bond), `verifyMarket`, `slashCreatorBond` | `transferCurator` (governance) |
| `governance` | `pauseMarket`, `resumeMarket`, `setParams`, `transferCurator/Governance/Treasury` | `transferGovernance` |
| `treasury` | příjemce slashnutých bondů | `transferTreasury` |

### 2.2 Storage

```solidity
IERC20 public immutable collateral;        // typicky TABcoin
IConditionalTokens public immutable ct;
address public curator;
address public governance;
address public treasury;
uint256 public defaultBond;                // kolik TABu se vyžaduje při createMarket
uint256 public creatorCancelWindow;        // sekundy, po které tvůrce může zrušit market bez slashe

mapping(uint256 => Market) public markets;
uint256 public marketCount;
```

`Market` struct (zhuštěno):
- identita: `creator`, `oracle`, `questionId`, `conditionId`, `outcomeSlotCount`, `outcomeType`, `description`, `category`
- časy: `createdAt`, `expiresAt`, `resolutionTime`
- ekonomika: `bondAmount`, `bondClaimed`, `bondSlashed`
- stav: `verified`, `canceled`, `resolved`, `paused`

### 2.3 OutcomeType validace (`_validateOutcomeShape`)

| Typ | Slots |
|---|---|
| `BINARY` | přesně 2 |
| `SCALAR` | přesně 2 (LOW/HIGH) |
| `MULTI` | ≥ 3 |
| `ORDINAL` | ≥ 2 |

PM2 nepřevádí scalar na škálu sám — to je úlohou oraclu při `reportPayouts` (vrátí `[H-x, x-L]` apod.).

### 2.4 Lifecycle funkce

#### `createMarket(...)`
1. Validace času (`expiresAt > now`, `resolutionTime ≥ expiresAt`) a outcome shape.
2. Pokud `defaultBond > 0`, stáhne ho v kolaterálu od `msg.sender`. **Tvůrce musí mít předem `approve` na PM2.**
3. Spočítá `questionId = keccak256(this ‖ marketId ‖ msg.sender ‖ now)` — deterministický a unikátní.
4. Volá `ct.prepareCondition(address(this), questionId, slots)` — PM2 se v CT zaregistruje **jako oracle**. Per-market oracle (parametr) je *interní* autentizační doménou PM2.
5. Uloží Market a emituje `MarketCreated`.

#### `cancelMarket(marketId)`
- Kdo může:
  - `creator` ≤ `createdAt + creatorCancelWindow` → bond se vrací (přes `claimCreatorBond` po resolution; cancel = resolved=true).
  - `curator` kdykoli před resolution → bond **slashed** do treasury.
- Akce: zapíše `canceled=true, resolved=true`, na CT pošle uniform payout `[1,1,...,1]`. To je důležité: díky tomu uživatelé můžou `redeemPositions` a každý dostane proporcionální podíl bez ohledu na to, jaký outcome měl.

> Pozn.: Kolaterál v CT je už od `splitPosition` v CT, ne v PM2. `cancel` jen nastaví payout vector. Vrácení peněz držitelům proběhne přes jejich vlastní `redeemPositions`.

#### `extendMarket(marketId, newExpiresAt, newResolutionTime)`
Tvůrce nebo curator. Pouze vpřed (`newExpiresAt ≥ m.expiresAt`).

#### `pauseMarket` / `resumeMarket`
Pouze governance. `pause` blokuje **resolveMarket** (žádné jiné volání pause neblokuje — cancel a extend jsou stále možné, ale resolution ne).

### 2.5 Curation

| Funkce | Auth | Efekt |
|---|---|---|
| `verifyMarket(marketId, bool)` | curator | flag `verified` (UX, žádný on-chain finanční dopad) |
| `slashCreatorBond(marketId)` | curator | bez canceling: bond → treasury (penalizace spam/invalid trhů, které ale mají běžet do konce) |
| `claimCreatorBond(marketId)` | creator | po `resolved=true` a pokud bond není slashed, vrátí bond tvůrci |

Bond životní cyklus má 3 koncové stavy: **claimed** (vrácen), **slashed** (do treasury), **stuck** (oba false → zaseklý ve smlouvě, ale v praxi nelze, protože resolved/canceled vždy umožní claim když není slashed).

### 2.6 Resolution

```solidity
function resolveMarket(uint256 marketId, uint256[] calldata payouts) external nonReentrant
```

- `msg.sender == m.oracle` (per-market oracle, ne globální curator/governance).
- `!resolved && !canceled && !paused`
- `payouts.length == m.outcomeSlotCount`
- Akce: `m.resolved = true`, pak `ct.reportPayouts(m.questionId, payouts)`.

PM2 je v CT registrovaný jako oracle (volání `prepareCondition` proběhlo s `oracle = address(this)`), takže CT přijme `reportPayouts` od PM2. Per-market `oracle` je jen interní autentizační vrstva PM2.

### 2.7 Reentrancy & bezpečnost
- `nonReentrant` na všech state-mutating funkcích, které pracují s tokeny (`createMarket`, `cancelMarket`, `slashCreatorBond`, `claimCreatorBond`, `resolveMarket`).
- `SafeERC20` na všech ERC-20 tocích.
- **Auth modely jsou ortogonální:** governance ≠ curator ≠ oracle ≠ creator. Záměr: oddělit "kdo schvaluje markety" od "kdo spravuje protokol" od "kdo reportuje výsledek".
- **questionId injektivita:** `keccak256(this, marketId, creator, now)` — `marketId` je unikátní → kolize prakticky vyloučena. Mezi různými PM2 deploymenty se ID liší díky `address(this)`.

### 2.8 Deploy parametry (`02_deploy_prediction_market_v2.ts`)
- `_collateral` = TABcoin
- `_ct` = ConditionalTokens
- `_curator / _governance / _treasury` = `process.env.*` nebo deployer
- `_defaultBond` = `50 TAB` (`50 * 1e18`)
- `_creatorCancelWindow` = 3600 s (1 hodina)

---

## 3. `PositionWrapper.sol`

ERC-20 obal nad **konkrétní** ERC-1155 conditional pozicí. Implementační kontrakt pro EIP-1167 minimal proxy clones (volá ho `PositionWrapperFactory`).

### 3.1 Vlastnosti
- Dědí `Initializable` + `ERC20Upgradeable` → **bez konstruktoru**, init jednou přes `initialize`.
- Implementuje `IERC1155Receiver` (jinak by ERC-1155 transfery do něj selhaly).
- Stav: `address public ct`, `uint256 public positionId`. Trvale spojuje wrapper s jednou konkrétní pozicí.

### 3.2 Initialize
```solidity
function initialize(string memory name_, string memory symbol_, address ct_, uint256 positionId_)
    external initializer
```
- Volá factory ihned po `Clones.clone`.
- `name_` / `symbol_` typicky `"Wrapped Position xxxx"` / `"wPOS-xxxx"` (factory je generuje z keys).

### 3.3 Wrap / Unwrap

| Funkce | Pre-condition | Akce |
|---|---|---|
| `wrap(amount)` | uživatel `setApprovalForAll(wrapper, true)` na CT | CT 1155 transfer `msg.sender → wrapper`, mint `amount` ERC-20 |
| `unwrap(amount)` | uživatel drží wrapped ERC-20 | burn `amount` ERC-20, CT 1155 transfer `wrapper → msg.sender` |

Poměr je vždy **1:1** (žádný fee, žádný oracle, žádná inflace). Wrapper je *čistá UX vrstva*, žádná ekonomika.

### 3.4 IERC1155Receiver
Vrací standardní selektory (`onERC1155Received`, `onERC1155BatchReceived`) → CT může bezpečně poslat tokeny. `supportsInterface` vrací `true` pro `IERC1155Receiver` a `IERC165`.

### 3.5 Bezpečnost a edge cases
- **Bez accesss controlu na wrap/unwrap** — kdokoli může wrapnout své pozice. Neexistuje admin.
- **Wrapper pozice po `redeemPositions` na CT je ztracena.** Pokud držitel ERC-20 nestihne unwrap před resolution + redeem, ERC-20 zůstane "naked claim" — ale `redeem` je akce držitele 1155, takže wrapper je drží do okamžiku unwrap. Dokud uživatel drží wrapped ERC-20, podkladová pozice je v wrapperu netknutá.
- **No reentrancy guard.** Wrap/unwrap používají `_mint` / `_burn` před / po 1155 transferu, ale 1155 transferFrom nevolá zpět arbitrární kód v `wrap` (msg.sender posílá, wrapper přijímá ⇒ zavolá se náš vlastní `onERC1155Received`). V `unwrap` voláme `safeTransferFrom(this, msg.sender, ...)` — pokud je `msg.sender` kontrakt s nepřátelským `onERC1155Received`, mohl by zavolat zpět **wrapper.unwrap** pro stejné množství. Nicméně náš `_burn` proběhl **před** transferem, takže opakovaný `unwrap` nemá zdroj a revertuje na `ERC20InsufficientBalance`. CEI pattern je dodržen.
- **Initialization:** `initializer` modifier zabraňuje druhému init. Implementační kontrakt sám **se nikdy neinitializuje** — frontend by neměl volat metody přímo na něj, jen na klony.

---

## 4. `PositionWrapperFactory.sol`

Idempotentní výrobce `PositionWrapper` klonů přes EIP-1167.

### 4.1 Storage
```solidity
address public immutable wrapperImpl;       // implementace, ze které se klonuje
address public immutable ct;                // ConditionalTokens
mapping(bytes32 => address) public wrapperOf;
// key = keccak256(abi.encode(collateral, conditionId, indexSet))
```

### 4.2 API

| Funkce | Pure? | Účel |
|---|---|---|
| `key(collateral, conditionId, indexSet)` | pure | derivovat lookup klíč |
| `getWrapper(...)` | view | vrátí adresu existujícího wrapperu (nebo `0x0`) |
| `getOrCreateWrapper(...)` | mutace | idempotentní; vrátí existující nebo nasadí nový klon, **vždy bezpečné volat z UI před wrap** |

### 4.3 Vytváření wrapperu
1. Spočítá `key`. Pokud existuje záznam → vrátí ho a hotovo (idempotence).
2. Z CT spočítá `collectionId = getCollectionId(conditionId, indexSet)` a `positionId = getPositionId(collateral, collectionId)`.
3. Vygeneruje lidské jméno: `name = "Wrapped Position <8hex>"`, `symbol = "wPOS-<8hex>"`. `<8hex>` = první 4 bajty `key` v hex (helper `_toHexShort`).
4. `Clones.clone(wrapperImpl)` → nový proxy.
5. Volá `IPositionWrapperInit(w).initialize(name, symbol, ct, positionId)`.
6. Uloží do `wrapperOf[k]` a emituje `WrapperCreated`.

### 4.4 Bezpečnostní pozn.
- **Bez accesss controlu** — kdokoli může vytvořit wrapper pro libovolnou (collateral, conditionId, indexSet). Trojice musí dávat smysl v CT, jinak wrapper sice bude existovat, ale nikdo do něj nic wrapnout nemůže (1155 balance pozice je 0).
- **Klíč pokrývá `collateral`** — různé kolaterály = různé wrappery i pro stejnou condition. Záměr: jeden CT + víc collateralů (forward-compat, i když PMv2 dnes deployuje jen TAB).
- **EIP-1167 minimal proxy** — gas-efektivní, ale wrapper kód je *neměnitelný*. Pokud by se implementace musela změnit, museli by se nasadit nové klony pod novou factory (a zmigrovat balance).
- **Idempotence:** opakované volání `getOrCreateWrapper` se stejnými argumenty nikdy nevytvoří duplicitní wrapper.

### 4.5 Deploy parametry (`04_deploy_position_wrapper_factory.ts`)
- `_wrapperImpl` = adresa nasazeného `PositionWrapper` (deploy 03)
- `_ct` = ConditionalTokens

---

## 5. `TABcoin.sol`

ERC-20 token sloužící jako **kolaterál pro CT**, **bond pro PM2** a obecně jako utilita.

### 5.1 Klíčové vlastnosti
- Dědí `ERC20`, `ERC20Burnable`. `decimals = 18` (override `pure`).
- **`AUTHORIZER` = `0x92e30b6A54911a3385Bcd69F2dEc998A13ef692f`** — `address public constant`, neměnný (zadrátovaný v kódu).
- `CLAIM_AMOUNT = 1000 * 1e18` (`1000 TAB`).

### 5.2 Storage

| Pole | Typ | Účel |
|---|---|---|
| `claimAuthorized[user]` | `mapping(address=>bool)` public | `true` ⇔ `_claimAllowance[user] > 0` (zachováno pro ABI kompatibilitu) |
| `claimConsumed[user]` | `mapping(address=>bool)` public | informativní — někdy claimnul (nikdy se neresetuje) |
| `_claimAllowance[user]` | `mapping(address=>uint256)` private | čítač zbývajících povolených claim-akcí |

### 5.3 API

| Funkce | Auth | Akce |
|---|---|---|
| `authorizeClaim(user)` | `onlyAuthorizer` | `_claimAllowance[user] += 1`; sync `claimAuthorized` |
| `revokeClaim(user)` | `onlyAuthorizer` | `_claimAllowance[user] -= 1` (jen pokud > 0); sync flagu |
| `claim()` | kdokoli | vyžaduje `_claimAllowance[msg.sender] > 0`; spotřebuje 1, mintne `CLAIM_AMOUNT` |
| `mint(to, amount)` | `onlyAuthorizer` | mintuje libovolné množství |
| `burn(amount) / burnFrom(...)` | dědí z `ERC20Burnable` | držitelé pálí své tokeny |

### 5.4 Eventy
`ClaimAuthorized`, `ClaimRevoked`, `Claimed`, `Minted` — pomáhají frontendu zobrazovat stav povolení/historie.

### 5.5 Bezpečnostní pozn.
- **Centralizovaný supply.** Authorizer má neomezené `mint` — uživatelé musejí důvěřovat protokolu.
- **Hardcoded authorizer** je vlastnost, nikoli bug — neexistuje cesta, jak ho přepsat. Pokud authorizer ztratí klíč, nový claim/mint není možný a kontrakt je pro mint zamrzlý.
- `unchecked { _claimAllowance[user] += 1 }` je bezpečné — overflow `uint256` je v praxi nedosažitelný (1× za tx).
- ABI je *záměrně* zachované: `claimAuthorized` zůstává `mapping(address=>bool)` aby starší integrace fungovaly i po přechodu z "1 povolení = 1 bool flag" na "N povolení = counter".

### 5.6 Vztah k PM stacku
- Defaultní `collateral` v `PredictionMarketV2` (per `02_deploy_prediction_market_v2.ts`).
- Bond v PM2 = TAB (deploy default `50 TAB`).
- CT bere TAB (nebo cokoli jiného ERC-20) v `splitPosition` jako kolaterál.

---

## 6. `YourContract.sol` _(legacy / scaffold-eth boilerplate)_

> **Není součástí produkčního stacku.** Je to nedotčená šablona z `scaffold-eth`. Drží se v repu jen kvůli `00_deploy_your_contract.ts` (lokální dev seed), ale frontend ji v PM-flow **nepoužívá**.

Stručně:
- Owner-only `withdraw()`.
- `setGreeting(string)` payable, počítá počet volání globálně i per-user.
- `receive()` přijímá ETH.

Pokud chceš, můžeme ho v dalším kroku odstranit (deploy script + .sol).

---

## 7. End-to-end flow uživatele (BINARY market)

1. **Deploy chain** (deploy skripty 00–04):
   `TABcoin → ConditionalTokens → PredictionMarketV2(TAB, CT, bond=50 TAB) → PositionWrapper (impl) → PositionWrapperFactory(impl, CT)`.

2. **Tvůrce vytvoří market:**
   - `TAB.approve(PMv2, 50e18)`
   - `PMv2.createMarket("Will X happen?", "crypto", BINARY, 2, oracle, expiresAt, resolutionTime)`
   - PM2 zaplatí `50 TAB` bond → drží na sobě, nahlásí condition do CT.

3. **Uživatel kupuje "YES" (indexSet=1):**
   - `TAB.approve(CT, amount)`
   - `CT.splitPosition(TAB, conditionId, [1, 2], amount)` → drží `amount` 1155 tokenů obou side (YES = bit0, NO = bit1).
   - Variantně: prodá NO za TAB / wrapne YES do ERC-20:
     - `factory.getOrCreateWrapper(TAB, conditionId, 1)` → adresa `wYES`.
     - `CT.setApprovalForAll(wYES, true)`
     - `wYES.wrap(amount)` → drží `amount` ERC-20 wYES.

4. **Resolution:**
   - Po `resolutionTime` zavolá `oracle.resolveMarket(marketId, [1,0])` (YES vyhrál).
   - PM2 přepošle do CT `reportPayouts(questionId, [1,0])`.

5. **Redeem:**
   - Držitel `wYES` zavolá `wYES.unwrap(amount)` → vyklopí 1155.
   - `CT.redeemPositions(TAB, conditionId, [1])` → spálí YES tokeny, vyplatí `amount * 1 / 1 = amount` TAB.
   - Držitel NO dostane 0.

6. **Tvůrce po resolution:**
   - `PMv2.claimCreatorBond(marketId)` → vrátí `50 TAB` (pokud nebyl slashnutý).

---

## 8. Bezpečnostní úvahy napříč stackem

| Riziko | Mitigace |
|---|---|
| Reentrancy na CT (kolaterál) | `nonReentrant` + CEI v split/merge/redeem |
| Reentrancy na PM2 (bond) | `nonReentrant` na všech token funkcích |
| Non-standard ERC-20 (USDT) | `SafeERC20` všude |
| Cross-condition kolize | `conditionId = keccak256(oracle, questionId, N)` injektivní; PM2 přidává `address(this) ‖ marketId` do `questionId` |
| Wrapper init front-running | `initialize` volá factory **atomicky** v rámci stejné tx jako `Clones.clone`; není okno na hijack |
| Curator zneužije `slashCreatorBond` | Známé riziko — je to záměrná pravomoc, předpokládá se důvěryhodný curator (governance ho může vyměnit) |
| Authorizer TAB zneužije `mint` | Akceptováno — TAB je *protocol-controlled* token |
| `cancelMarket` po `splitPosition` zamrzne kolaterál | Ne — uniform payout `[1,1,...,1]` umožní každému `redeemPositions` v poměru 1:1 |
| Pause během resolution | Záměrné: `pauseMarket` blokuje `resolveMarket`. Cancel + extend zůstávají dostupné |

---

## 9. Závislosti

| Kontrakt | OZ moduly |
|---|---|
| ConditionalTokens | `ERC1155`, `IERC20`, `SafeERC20`, `ReentrancyGuard` |
| PredictionMarketV2 | `IERC20`, `SafeERC20`, `ReentrancyGuard` |
| PositionWrapper | `Initializable`, `ERC20Upgradeable`, `IERC1155`, `IERC1155Receiver`, `IERC165` |
| PositionWrapperFactory | `Clones` (EIP-1167) |
| TABcoin | `ERC20`, `ERC20Burnable` |

---

## 10. Gas — orientační odhady

> **Disclaimer.** Čísla níže jsou **hrubé odhady** založené na složení operace (SSTORE = ~20k cold / ~5k warm, externí call ~2.6k+ payload, ERC-1155/ERC-20 mint/burn). Reálné hodnoty se liší podle:
> - délky stringů (`description`, `category`, `name`, `symbol`),
> - cold vs warm storage (první vs. následný call do stejných slotů),
> - velikosti `partition[]` / `indexSets[]` / `outcomeSlotCount`,
> - aktuálního EVM základu (gas cost pravidel po Cancun/Pectra).
>
> Pro autoritativní čísla pusť `REPORT_GAS=true npx hardhat test` (hardhat-gas-reporter) na konkrétní scénář.

### 10.1 `ConditionalTokens.sol`

| Funkce | Odhad gas | Hlavní položky |
|---|---|---|
| `prepareCondition` (N=2, binary) | **~110–140k** | 4× SSTORE struct + alokace `payoutNumerators[2]` + event |
| `prepareCondition` (N=10) | **~200–260k** | + 8 dalších array slotů |
| `reportPayouts` (N=2) | **~55–80k** | 2× SSTORE numerators + denom + resolved + event |
| `reportPayouts` (N=10) | **~140–200k** | 10× SSTORE + iterace |
| `splitPosition` (K=2 partition, kolaterál warm) | **~160–220k** | safeTransferFrom (~55k) + `_mintBatch` 2 ERC-1155 + event |
| `splitPosition` (K=2, první transfer = cold) | **~190–260k** | + cold storage warm-up pro balance |
| `mergePositions` (K=2) | **~110–160k** | `_burnBatch` (cheaper than mint) + safeTransfer |
| `redeemPositions` (1 winning indexSet, binary) | **~85–130k** | balance read + burn + transfer na konci |
| `redeemPositions` (víc indexSets) | + ~30–50k každý další | per-iteration loop, payout summed |

### 10.2 `PredictionMarketV2.sol`

| Funkce | Odhad gas | Pozn. |
|---|---|---|
| `createMarket` (krátké stringy ≤32B, bond > 0) | **~330–450k** | stores `Market` (~10 SSTORE) + 2× short string + bond transfer (~55k) + `ct.prepareCondition` (~110k) + event |
| `createMarket` (dlouhé stringy ~200B description) | **~450–600k** | každý 32B chunk stringu = 1 SSTORE navíc |
| `cancelMarket` (creator path) | **~90–130k** | flagy + `reportPayouts` (~60k pro N=2) |
| `cancelMarket` (curator path, slash) | **~140–190k** | + bond transfer + `BondSlashed` event |
| `extendMarket` | **~35–55k** | 2× SSTORE + event |
| `pauseMarket` / `resumeMarket` | **~30–45k** | 1× SSTORE + event |
| `verifyMarket` | **~30–45k** | 1× SSTORE + event |
| `slashCreatorBond` | **~75–110k** | flag + transfer + event |
| `claimCreatorBond` | **~55–85k** | flag + transfer + event |
| `resolveMarket` (N=2) | **~95–135k** | flag + `ct.reportPayouts` |
| `resolveMarket` (N=10) | **~180–250k** | větší payout vector |
| `setParams` / `transferCurator/Governance/Treasury` | **~30–50k** | jeden SSTORE + event |

### 10.3 `PositionWrapper.sol` (per klon)

| Funkce | Odhad gas | Pozn. |
|---|---|---|
| `initialize` (volá factory) | **~110–160k** | ERC20 name+symbol storage + `ct` + `positionId` + initializer flag |
| `wrap(amount)` | **~95–140k** | `safeTransferFrom` 1155 → wrapper (`onERC1155Received` callback) + ERC-20 `_mint` |
| `unwrap(amount)` | **~75–115k** | ERC-20 `_burn` (warm cheaper) + 1155 `safeTransferFrom` ven |
| `transfer` (standardní ERC-20) | **~35–55k** | běžný OZ ERC-20 |

### 10.4 `PositionWrapperFactory.sol`

| Funkce | Odhad gas | Pozn. |
|---|---|---|
| `getWrapper` (view) | **0** (off-chain call) | jen SLOAD |
| `getOrCreateWrapper` — **existující** wrapper | **~28–38k** | 1× SLOAD + return |
| `getOrCreateWrapper` — **nové** klonování | **~210–290k** | `Clones.clone` (~32k pro EIP-1167 proxy deploy) + 2× ID kalkulace na CT (pure, levné) + externí `initialize` call (~110–160k) + SSTORE map + event |
| Klíčový rozdíl | první volání pro nový (collateral, conditionId, indexSet) je drahé; všechna další pro stejnou trojici jsou skoro zadarmo | doporučení: UI volá `getOrCreate` jen jednou per market+side a adresu si cachuje |

### 10.5 `TABcoin.sol`

| Funkce | Odhad gas | Pozn. |
|---|---|---|
| `authorizeClaim(user)` | **~50–75k** | counter SSTORE + bool sync + event (cold první volání ~75k, další ~50k) |
| `revokeClaim(user)` | **~35–55k** | jen pokud allowance > 0 |
| `claim()` | **~85–115k** | counter dec + bool sync + first-time `claimConsumed` SSTORE + `_mint` + event |
| `claim()` (druhý a další) | **~65–95k** | bez `claimConsumed` SSTORE |
| `mint(to, amount)` | **~50–75k** | `_mint` (cold/warm) + event |
| `transfer` | **~35–55k** | standardní ERC-20 |
| `burn` | **~30–45k** | `_burn` |

### 10.6 End-to-end gas pro typický BINARY scénář

| Krok | Adresa | Odhad |
|---|---|---|
| 1. `TAB.approve(PMv2, 50e18)` | TABcoin | ~46k |
| 2. `PMv2.createMarket(...)` (krátké stringy, bond=50) | PMv2 | ~380k |
| 3. `TAB.approve(CT, amount)` | TABcoin | ~46k |
| 4. `CT.splitPosition(TAB, cid, [1,2], amount)` | CT | ~190k |
| 5. `factory.getOrCreateWrapper(TAB, cid, 1)` (1. volání) | Factory | ~250k |
| 6. `CT.setApprovalForAll(wYES, true)` | CT | ~46k |
| 7. `wYES.wrap(amount)` | Wrapper | ~115k |
| 8. (po resolution) `oracle.resolveMarket(id, [1,0])` | PMv2 | ~115k |
| 9. `wYES.unwrap(amount)` | Wrapper | ~95k |
| 10. `CT.redeemPositions(TAB, cid, [1])` | CT | ~110k |
| 11. `PMv2.claimCreatorBond(id)` | PMv2 | ~70k |
| **Σ** (creator + holder dohromady) | | **~1.46M gas** |

Pro porovnání:
- Plný flow **bez** wrapperu (čisté CT pozice): ~960k.
- Wrapper si "kupuješ" za ~365k navíc (factory create + wrap + unwrap), za to získáš ERC-20 fungovatelnost a kompozici s DeFi.

### 10.7 Optimalizační tipy

- **Krátké stringy** v `createMarket` šetří desítky tisíc gas (každý 32B chunk = 1 SSTORE). Description nad 32B se vyplatí *hashovat off-chain* a do contractu posílat jen hash + URL.
- **Wrapper recyklace:** factory je idempotentní — `getOrCreate` cachuj na FE, neplať 250k pokaždé.
- **Batch redeem:** `redeemPositions` přijímá pole `indexSets[]`. Při více vyhrávajících setech je jeden call levnější než N samostatných.
- **`approve(MAX)` vs. exact:** standardní úvaha — MAX šetří gas na opakovaných transferech, ale rozšiřuje attack surface.

---

## 11. Co (zatím) chybí / TODO pro budoucí rozšíření

- **AMM / orderbook** pro wrapped pozice (off-chain matching nebo on-chain CLOB) — orderbook frontend už scaffolduje.
- **Dispute window** mezi `resolveMarket` a finálním `reportPayouts` — dnes je oracle final.
- **Multi-collateral** v PM2 (CT to umí, PM2 zatím drží 1 immutable collateral).
- **Governance timelock** — dnes governance funkce jdou okamžitě.
- **Nested conditions** (Gnosis CTF parent collections) — explicitně mimo scope V2.
