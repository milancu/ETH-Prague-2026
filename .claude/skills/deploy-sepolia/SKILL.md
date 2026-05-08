---
name: deploy-sepolia
description: Pre-deploy checklist a guided deployment na Base Sepolia (primární testnet projektu — i když skill jméno říká "sepolia", kontrakty cílí na Base Sepolia). Ověří env proměnné, zkompiluje, pustí testy, deploye TABcoin → ConditionalTokens → PredictionMarketV2 → PositionWrapper(impl) → PositionWrapperFactory → TabClob, ověří sync `deployedContracts.ts`, verifikace na Etherscan. Vyvolej, kdykoli chceš pushnout změny smart kontraktů na Base Sepolia.
allowed-tools: Read, Edit, Bash(yarn:*), Bash(npx hardhat:*), Bash(cat apps/contracts/packages/hardhat/.env), Bash(test -f *), Bash(git status:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git diff:*), Bash(find:*), Bash(ls:*)
---

# Deploy na Base Sepolia — checklist

Provádí se z root repa, ale většinu příkazů spouštíš v `apps/contracts/packages/hardhat/`. Sleduj kroky **v pořadí** a u každého ověř výstup, než pokračuješ.

> **Pozn.:** I když se skill jmenuje `deploy-sepolia`, projekt cílí na **Base Sepolia** (`baseSepolia` v `hardhat.config.ts`, chainId 84532). Ethereum Sepolia (`sepolia`, chainId 11155111) je v configu taky, ale není primární cíl. Pokud chceš deploynout na něco jiného než Base Sepolia, řekni si o to explicitně.

## 0. Sanity checks (nepřeskakuj)

```bash
git status                          # žádné rozpracované změny v apps/contracts/?
git rev-parse --abbrev-ref HEAD     # jsi na správné větvi?
git log -1 --oneline                # poslední commit obsahuje, co chceš deploynout?
```

Pokud je working tree dirty v `apps/contracts/packages/hardhat/contracts/` nebo `apps/contracts/packages/hardhat/deploy/`, zastav se a zeptej uživatele, zda commitnout / stashnout.

Bonus: ověř že `deployedContracts.ts` je v `.gitignore` (per-dev artefakt) — pokud z nějakého důvodu není, neřeš to v rámci tohohle deploye.

## 1. Env proměnné

Zkontroluj `apps/contracts/packages/hardhat/.env` (jen ověř existenci klíčů, **nečti private key do logu ani odpovědi**):

- Deployer private key — projekt používá custom wrapper `runHardhatDeployWithPK.ts`, který si PK řeší sám (pravděpodobně `__RUNTIME_DEPLOYER_PRIVATE_KEY` nebo přes `yarn account:import`). Spustí se přes `yarn deploy --network baseSepolia`. Pokud ti deploy začne ptát na heslo nebo failne s "no signer", zkontroluj `scripts/runHardhatDeployWithPK.ts`.
- `ALCHEMY_API_KEY` — pro ostatní sítě v configu (není striktně nutné pro `baseSepolia`, který má hardcoded `https://sepolia.base.org`, ale config ho stejně použije pro forking)
- `ETHERSCAN_V2_API_KEY` (nebo `ETHERSCAN_API_KEY`, ověř v `hardhat.config.ts`) — pro verifikaci

Pokud něco chybí, **zastav se** a řekni uživateli, ať doplní. **Nikdy** nepiš private key do logu, příkazu ani odpovědi.

## 2. Kompilace + testy

```bash
cd apps/contracts/packages/hardhat
yarn compile
yarn test                           # `REPORT_GAS=true hardhat test --network hardhat`
```

Když testy spadnou, zastav se. Žádný „push i přes failing testy" bez explicitního pokynu.

## 3. Plán deploye

Z `apps/contracts/packages/hardhat/deploy/` vidíš pořadí (řízeno `func.dependencies` v hardhat-deploy):

1. `00_deploy_your_contract.ts` — SE-2 boilerplate (`YourContract`). **Pravděpodobně přeskočit na testnetu** — nemá pro projekt účel. Buď ji smaž z deploye (`func.skip`), nebo pomoc s rebrandem na něco užitečného.
2. `01_deploy_tabcoin.ts` — `TABcoin` (TAB ERC-20). Hardcoded `AUTHORIZER` v kontraktu, takže constructor nebere parametry řešící autorizaci.
3. `02_deploy_conditional_tokens.ts` — `ConditionalTokens` (ERC-1155). Bez constructor argů (vlastní URI je v kódu).
4. `03_deploy_prediction_market_v2.ts` — `PredictionMarketV2`. Constructor args: `collateral` (TAB), `ct` (ConditionalTokens), `curator`, `governance`, `treasury`, `defaultBond`, `creatorCancelWindow`. **Ověř konkrétní hodnoty před deployem.** Curator/governance/treasury by neměly být zero ani test wallety na produkci.
5. `04_deploy_position_wrapper.ts` — `PositionWrapper` (implementation pro Clones).
6. `05_deploy_position_wrapper_factory.ts` — `PositionWrapperFactory`. Constructor args: `wrapperImpl` (z #5), `ct` (z #3).
7. `06_seed_accounts.ts` — **přeskakuje se na chainId != 31337** (`require chainId == 31337`). Na Base Sepolia neběží — nepotřebuješ tam žádný impersonate, AUTHORIZER musí mintnout TAB ručně přes svůj wallet po deployi.
8. `07_deploy_tab_clob.ts` — `TabClob`. Constructor args: jméno + verze pro EIP-712 domain.

Vypiš plán uživateli a počkej na potvrzení, než spustíš krok 4.

## 4. Deploy

```bash
cd apps/contracts/packages/hardhat
yarn deploy --network baseSepolia
```

(Skript `deploy` v `package.json` je `ts-node scripts/runHardhatDeployWithPK.ts` — to je projektový wrapper, který forwarduje argumenty do hardhat-deploy. Pokud potřebuješ jen určité kontrakty, použij `--tags <Tag>`.)

Logy si nech — adresy budou potřeba pro krok 6 a 7. Hardhat-deploy zapíše JSON soubory do `apps/contracts/packages/hardhat/deployments/baseSepolia/<Contract>.json` (per kontrakt, s adresou + ABI + tx hash + deploy block).

## 5. Sync ABIs do frontendu

`packages/nextjs/contracts/deployedContracts.ts` se generuje automaticky přes `apps/contracts/packages/hardhat/scripts/generateTsAbis.ts` při deployi. Soubor je **gitignored** (per-dev artefakt). Ověř, že existuje a obsahuje záznam pro Base Sepolia (`chainId: 84532`):

```bash
ls -la apps/contracts/packages/nextjs/contracts/deployedContracts.ts
grep -c "84532" apps/contracts/packages/nextjs/contracts/deployedContracts.ts
```

Pokud chybí, spusť ručně skript (pravděpodobně `yarn deploy` ho už pustil; jinak se podívej do hardhat-deploy postDeploy hook).

**Production frontend (`apps/web/`) zatím čte odjinud** — `packages/shared/src/abis/` + `packages/shared/src/addresses/baseSepolia.json`. Pokud `packages/shared/` ještě neexistuje (T0.1 v `docs/tasks.md`), zatím přepiš adresy ručně tam, kde je `apps/web/` čte. Zeptej se uživatele.

## 6. Etherscan verifikace

Pro Base Sepolia:

```bash
cd apps/contracts/packages/hardhat
yarn verify --network baseSepolia
```

Tohle pustí `hardhat etherscan-verify` (z `@nomicfoundation/hardhat-verify`), který se podívá do `deployments/baseSepolia/` a zverifikuje všechno, co tam najde. Pokud chce ručně:

```bash
yarn hardhat-verify --network baseSepolia <ADRESA> "<arg1>" "<arg2>"
```

Konkrétní args čerpej z deploy skriptů (`args:` v `03_deploy_prediction_market_v2.ts` atd.).

Ověř na BaseScan pro každý kontrakt: `https://sepolia.basescan.org/address/<addr>` má bytecode + verified status.

`PositionWrapper` klony (per-market ERC-20) ne — ty se verifikují přes Etherscan "verify proxy" / Sourcify nebo bytecode-match. Když verify failne na klonech, je to OK, hlavně mají verifikovanou implementaci.

## 7. Mintnutí TAB pro test wallety

Na Base Sepolia se `06_seed_accounts.ts` neběží. Pokud potřebuješ test wallety s TAB:

- Pokud máš PK k `AUTHORIZER` (`0x48c5632dCC220Abf56000F93B1C4DEB501c64588`): zavolej `TABcoin.mint(addr, amount)` přímo (přes BaseScan UI nebo viem skript).
- Pokud nemáš PK k `AUTHORIZER`: musíš použít workflow přes `authorizeClaim(addr)` → user pak volá `claim()` (mintne 1000 TAB). Ale `authorizeClaim` taky musí volat `AUTHORIZER`.
- **Bez PK pro AUTHORIZER nelze emitovat žádný TAB na Base Sepolia.** Ověř, že někdo z týmu ten klíč má, předtím než deployneš. Hardcoded address = single point of failure.

## 8. Dokumentace adres

Pokud existuje `README.md` nebo `DEPLOYED.md` v rootu (ten teď neexistuje), doplň záznam:

```
## Base Sepolia (chainId 84532) — <YYYY-MM-DD>
- TABcoin: 0x...
- ConditionalTokens: 0x...
- PredictionMarketV2: 0x...
- PositionWrapper (impl): 0x...
- PositionWrapperFactory: 0x...
- TabClob: 0x...
- Commit: <git short hash>
```

Až bude existovat `packages/shared/src/addresses/baseSepolia.json`, zapiš tam.

## 9. Smoke test

Před tím, než řekneš „hotovo":

1. Otevři `https://sepolia.basescan.org/address/<PredictionMarketV2>` — má bytecode? Je verified?
2. Volání `TABcoin.mint(testWallet, 100e18)` z AUTHORIZER walletu — projde?
3. Approve TAB pro PredictionMarketV2 → `PredictionMarketV2.createMarket(...)` — projde, emituje `MarketCreated` event?
4. `ConditionalTokens.splitPosition` (z testWallet, který má TAB + approval pro CT) — projde, emituje `PositionSplit`?
5. `PositionWrapperFactory.getOrCreateWrapper(...)` pro vytvořený `(collateral, conditionId, indexSet)` → vrátí novou wrapper adresu, emituje `WrapperCreated`?
6. `PositionWrapper.wrap(amount)` — projde, ERC-20 balance se objeví?
7. EIP-712 podpis Order pro TabClob → `TabClob.fill(order, sig)` → projde, emituje `OrderFilled`?

Tohle je full happy path. Pokud něco failne na konkrétním kroku, zastav se a debug.

## Failure modes

- **„nonce too low"** — z RPC cache. Počkej minutu nebo zruš pending tx z deployer účtu (`yarn account` → resend pending nonce s vyšším gasem).
- **„insufficient funds"** — deployer nemá Base Sepolia ETH. Faucet pro Base Sepolia: ať si uživatel řekne sám, nehádej URL.
- **Verifikace failuje s „bytecode mismatch"** — kontrakt byl kompilován s jinou solc verzí / optimizer settings. Zkontroluj `solidity` block v `hardhat.config.ts`.
- **`deployedContracts.ts` se nezaktualizoval** — `scripts/generateTsAbis.ts` se má volat z post-deploy hooku. Pokud ne, spusť ručně.
- **AUTHORIZER nemá ETH** — nelze volat `mint`/`authorizeClaim`. Musí mu někdo poslat ETH na Base Sepolii dřív.

## Důležité — co NEdělat

- Nepoužívej `--no-verify` na pre-commit hook bez výslovného svolení uživatele.
- Nikdy `git push --force` na main po deployi.
- Nedeploy na Base mainnet skrz tenhle skill — je explicitně pro Base Sepolii. Pro mainnet vyvolej zvlášť `/deploy-base-mainnet` (až existuje).
- Nikdy nelogovat ani nezobrazovat private keys, environment file content, nebo seed phrases.
