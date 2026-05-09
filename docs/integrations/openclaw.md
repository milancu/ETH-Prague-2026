# Integration: OpenClaw (SKILL.md)

OpenClaw consumes "skills" — markdown files describing capabilities and how
to invoke them. Drop a `SKILL.md` referencing our REST API into the user's
skills directory and the agent picks it up.

---

## Install

Save the snippet below as `~/.openclaw/skills/prediction-market.md`:

````markdown
---
name: prediction-market
description: Read prediction markets, build betting calldata, and fetch real-time market intelligence on a Czech prediction-market dApp on Base Sepolia.
endpoints:
  base_url: ${API_BASE_URL:-http://localhost:8000}
---

# Prediction Market Skill

Tools for interacting with a Czech prediction-market dApp. The user signs
all transactions in their own wallet; this skill never sees a private key.

## Tools

### list_markets — Free
GET ${base_url}/v1/markets?category=&status=&page=1&limit=20

### get_market — Free
GET ${base_url}/v1/markets/{market_id}

### get_market_orderbook — Free
GET ${base_url}/v1/markets/{market_id}/orderbook

### get_balance — Free
GET ${base_url}/v1/balance/{address}

### prepare_buy — Free, returns calldata
POST ${base_url}/v1/prepare/buy
Body: { market_id, slot, amount_tab (wei string), user_address }
Returns: TxCard ({ to, data, value, chain_id, summary, requires[] })
**Sign locally — see "Signing" below.**

### prepare_sell, prepare_create_market, prepare_claim, prepare_merge, prepare_cancel_order
Same pattern. POST + body → TxCard or OrderCard. User signs.

### fetch_tweets, fetch_reddit, fetch_news, analyze_market, markets_with_buzz — $0.50–$0.75 USDC
POST ${base_url}/v1/intelligence/{tool}
Returns 402 with PAYMENT-REQUIRED header on first call.
Sign with x402 (USDC on Base Sepolia, eip155:84532), retry with
PAYMENT-SIGNATURE header.

## Signing

Calldata signing happens in the user's environment, not via this skill:
- `cast send --private-key $PK --rpc-url $RPC <to> <data>` (foundry)
- `viem.walletClient.sendTransaction({ to, data, value })`
- `web3.eth.account.sign_transaction(...)` + `eth.send_raw_transaction(...)`

Run all entries of `requires[]` in order before the main tx.

## Hard rules

1. Never reference a market that wasn't returned by a tool result.
2. Never propose a tx without first calling `prepare_*`.
3. Reference markets by `marketId` (e.g. "market #5"), never by raw address.
4. Money amounts are TAB unless stated. Use human-readable amounts, not wei.
5. Czech or English to match the user.
````

---

## Required env vars

- `API_BASE_URL` — defaults to `http://localhost:8000`. For a deployed
  backend, set to the public URL.
- `BASE_RPC_URL` — for `cast send` signing on the user's side.
- `USER_PRIVATE_KEY` — only on the user's side; the skill never reads it.

---

## Example prompts

Czech:

> "Vsadit 10 TAB na ANO v marketu 5."
> "Vytvoř trh: bude Bitcoin přes 200 000 USD do 31.12.?"
> "Co všechno vlastním? Adresa 0x..."

English:

> "List markets in the politics category."
> "Build me a buy of 10 TAB on YES in market 5."
> "Did I win on market 3? My address is 0x..."

For a paywalled call:

> "Fetch tweets about the Czech parliamentary elections."
> → skill returns 402, asks user to authorize $0.50 spend, signs, retries.

---

## Troubleshooting

- **Skill not picked up** — confirm the file is in `~/.openclaw/skills/` and
  has the YAML frontmatter (`name:`, `description:`).
- **`502 calldata build failed`** — backend can't reach the chain RPC.
  Check the server's `BASE_RPC_URL`.
- **`404 market not found`** — the market exists on-chain but hasn't been
  registered via `POST /v1/markets`. Run the indexer or register manually.
- **402 with no auto-retry** — OpenClaw's x402 client may not be configured.
  Set `X402_CLIENT_PK` in the agent's env, or fall back to a Python bot
  for paid calls.
