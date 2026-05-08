---
name: deploy-sepolia
description: Pre-deploy checklist a guided deployment na Sepolia testnet. Ověří env proměnné, zkompiluje, pustí testy, deploye TABcoin → PredictionTokenImpl → PredictionMarket → PoolHelper, sync deployedContracts.ts do frontendu, verifikace na Etherscan. Vyvolej, kdykoli chceš pushnout změny smart kontraktů na Sepolia.
allowed-tools: Read, Edit, Bash(yarn hardhat:*), Bash(yarn deploy:*), Bash(yarn next:*), Bash(npx hardhat:*), Bash(cat packages/hardhat/.env), Bash(test -f *)
---

# Deploy na Sepolia — checklist

Provádí se v `packages/hardhat/`. Sleduj kroky **v pořadí** a u každého ověř výstup, než pokračuješ.

## 0. Sanity checks (nepřeskakuj)

```bash
git status                          # žádné rozpracované změny v contracts/?
git rev-parse --abbrev-ref HEAD     # jsi na správné větvi?
git log -1 --oneline                # poslední commit obsahuje, co chceš deploynout?
```

Pokud je working tree dirty v `packages/hardhat/contracts/` nebo `packages/hardhat/deploy/`, zastavte se a zeptejte se uživatele, zda commitnout / stashnout.

## 1. Env proměnné

Zkontroluj `packages/hardhat/.env` (nikdy ho nečti celý do kontextu — jen kontrola existence klíčů). Musí obsahovat:

- `__RUNTIME_DEPLOYER_PRIVATE_KEY` (nebo ekvivalent — podívej se na `hardhat.config.ts`, jak se jmenuje)
- `ALCHEMY_API_KEY` — pro Sepolia RPC
- `ETHERSCAN_API_KEY` — pro verifikaci

Pokud něco chybí, **zastav se** a řekni uživateli, ať doplní. **Nikdy** nepiš private key do logu, příkazu ani odpovědi.

## 2. Kompilace + testy

```bash
yarn hardhat:compile
yarn hardhat:test            # pokud existuje test suite
```

Když testy spadnou, zastav se. Žádný „push i přes failing testy" bez explicitního pokynu.

## 3. Plán deploye

Z `packages/hardhat/deploy/` vidíš pořadí (řízeno `func.dependencies`):
1. `00_deploy_TABcoin.ts`
2. `01_deploy_prediction_token_impl.ts`
3. `01_deploy_prediction_market.ts` — závisí na 1, 2
4. `02_deploy_pool_helper.ts` — závisí na 3
5. `00_fund_admin.ts` — utility, posuď, jestli ji chceš pouštět na testnetu (mintne TABcoiny adminovi)

`00_deploy_mock_factory.ts` a `00_deploy_your_contract.ts` — **ověř, jestli je chceš na Sepolii**. `MockUniswapV3Factory` je mock, na testnetu pravděpodobně ne (raději napoj reálnou Uniswap V3 factory na Sepolii, jinak budeš mít falešné TWAP).

Vypiš plán uživateli a počkej na potvrzení, než spustíš krok 4.

## 4. Deploy

```bash
yarn deploy --network sepolia
```

Logy si nech — adresy budou potřeba pro krok 6 a 7.

## 5. Sync do frontendu

Scaffold-ETH normálně automaticky generuje `packages/nextjs/contracts/deployedContracts.ts`. Ověř:

```bash
git diff packages/nextjs/contracts/deployedContracts.ts
```

Měl by obsahovat nové adresy pro `chainId: 11155111` (Sepolia). Pokud chybí, spusť ručně:

```bash
yarn hardhat:deploy --network sepolia --tags <Tag>   # nebo whatever scaffold-eth příkaz to dělá
```

Pak ověř, že `yarn next:check-types` projde.

## 6. Etherscan verifikace

```bash
yarn hardhat:verify --network sepolia <ADRESA> "<arg1>" "<arg2>"
```

Konkrétní argumenty čerpej z deploy skriptu (`args:` v `01_deploy_prediction_market.ts` atd.). Verifikuj **všechny** kontrakty: TABcoin, PredictionTokenImpl, PredictionMarket, PoolHelper.

PredictionToken klony (per-bet ERC20) ne — ty se verifikujou přes "verify proxy" nebo přes copy bytecode-match na Etherscanu. Když verify failuje na klonech, je to OK, hlavně mají verifikovanou implementaci.

## 7. Dokumentace adresí

Pokud existuje `README.md` nebo `DEPLOYED.md` v rootu, doplň záznam:

```
## Sepolia (chainId 11155111) — <YYYY-MM-DD>
- TABcoin: 0x...
- PredictionTokenImpl: 0x...
- PredictionMarket: 0x...
- PoolHelper: 0x...
- Commit: <git short hash>
```

## 8. Smoke test

Před tím, než řekneš „hotovo":

1. Otevři `https://sepolia.etherscan.io/address/<PredictionMarket>` — má bytecode? je verified?
2. V nextjs frontendu (`yarn next:dev` nebo deploy preview) přepni wallet na Sepolia, zkus `createBet` — projde tx?
3. `fundBet` malou částkou TABcoinu — projde a vidíš `BetFunded` event?

## Failure modes

- **„nonce too low"** — z Alchemy/Infura cache. Počkej minutu nebo zruš pending tx z deployer účtu.
- **„insufficient funds"** — deployer nemá Sepolia ETH. Sepolia faucet: ať si uživatel řekne sám, nehádej URL.
- **Verifikace failuje s „bytecode mismatch"** — kontrakt byl kompilován s jinou solc verzí / optimizer settings. Zkontroluj `hardhat.config.ts` solc settings.
- **deployedContracts.ts se nezaktualizoval** — scaffold-eth má vlastní generator. Zkontroluj `packages/nextjs/scripts/` nebo root `package.json` script `deploy`.

## Důležité — co NEdělat

- Nepoužívej `--no-verify` na pre-commit hook bez výslovného svolení uživatele.
- Nikdy `git push --force` na main po deployi (jiní lidé mohou mít fetch).
- Nedeploy na mainnet skrz tenhle skill — je explicitně pro Sepolii. Pro mainnet vyvolej zvlášť `/deploy-mainnet` (až existuje).
