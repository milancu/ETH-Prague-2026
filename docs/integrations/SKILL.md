---
name: prediction-market
description: Read prediction markets, build betting calldata, and fetch real-time market intelligence on a Czech prediction-market dApp on Base Sepolia.
endpoints:
  base_url: ${API_BASE_URL:-https://api.kowalski-market.com}
  mcp_url: ${API_BASE_URL:-https://api.kowalski-market.com}/mcp/
  openapi: ${API_BASE_URL:-https://api.kowalski-market.com}/api/openapi.json
---

# Prediction Market Skill

Tools for interacting with a Czech prediction-market dApp on Base Sepolia.
The user signs all transactions in their own wallet — this skill never sees a private key.

## Hard rules

1. Never reference a market, price, or balance you did not get from a tool result.
2. Never propose a transaction without first calling a `prepare_*` tool. The frontend rejects any tx without a TxCard.
3. Reference markets by `market_id` (e.g. "market #5"), never by raw address.
4. Money amounts are TAB (18 decimals). Always show human-readable amount, not wei.
5. Czech or English — match the user.
6. If unsure, call more tools. Never guess.

## Free read tools

### list_markets
GET ${base_url}/v1/markets?category=&status=&page=1&limit=20
Returns: `{ markets: [...], total, page, limit }`

### get_market
GET ${base_url}/v1/markets/{market_id}
Returns full market metadata: condition_id, outcomes, status, timestamps.

### get_market_orderbook
GET ${base_url}/v1/markets/{market_id}/orderbook
Returns: `{ bids: [{ price, amount, maker, ... }], asks: [...] }`

### get_balance
GET ${base_url}/v1/balance/{address}
Returns: `{ balance: "raw_wei", formatted: "10.000000" }`

### get_user_positions
GET ${base_url}/v1/markets/{market_id}/positions/{address}
Returns ERC-1155 + ERC-20 position balances per outcome slot.

### list_orders
GET ${base_url}/v1/orders?market_id=&maker=
Returns all CLOB orders, filterable by market and maker.

## Calldata builder tools (free)

### prepare_buy
POST ${base_url}/v1/prepare/buy
Body: `{ market_id, slot, amount_tab (wei string), user_address }`
Returns: TxCard `{ to, data, value, chain_id, summary, requires[] }`
**User signs requires[] first (in order), then the main tx.**

### prepare_sell
POST ${base_url}/v1/prepare/sell
Body: `{ market_id, slot, maker_amount, taker_amount, user_address, expiry }`
Returns: OrderCard with EIP-712 typed_data — user signs, then POST /v1/orders.

### prepare_create_market
POST ${base_url}/v1/prepare/create-market
Body: `{ name, description, category, outcome_type, outcome_slot_count, outcome_labels, oracle, expires_at, resolution_time }`
Returns: TxCard with TAB.approve precondition.

### prepare_claim
POST ${base_url}/v1/prepare/claim
Body: `{ market_id, index_sets }`
Returns: TxCard for claiming winnings on a resolved market.

### prepare_merge
POST ${base_url}/v1/prepare/merge
Body: `{ market_id, amount, partition? }`
Returns: TxCard for burning a full set of outcome tokens to recover TAB.

### prepare_cancel_order
POST ${base_url}/v1/prepare/cancel-order
Body: `{ order_id }`
Returns: TxCard for cancelling an existing CLOB order.

## Paywalled intelligence tools ($0.50–$0.75 USDC)

These return HTTP 402 on first call. Sign the x402 payment challenge (USDC on Base Sepolia, eip155:84532) and retry with PAYMENT-SIGNATURE header.

### fetch_tweets — $0.50
POST ${base_url}/v1/intelligence/tweets
Body: `{ query, max_items? }`

### fetch_reddit — $0.50
POST ${base_url}/v1/intelligence/reddit
Body: `{ query, max_items? }`

### fetch_news — $0.50
POST ${base_url}/v1/intelligence/news
Body: `{ query, max_items?, language? }`

### analyze_market — $0.50
POST ${base_url}/v1/intelligence/analyze
Body: `{ market_title, category?, max_items? }`
Returns tweets + news aggregated for a market topic.

### markets_with_buzz — $0.75
POST ${base_url}/v1/intelligence/markets-with-buzz
Body: `{ market_titles: [...], max_tweets_per_market? }`
Returns tweet count and top tweet per market.

## Common workflows

**"What's the bid-ask spread on market X?"**
→ list_markets → find market_id
→ get_market_orderbook(market_id) → bids[] and asks[] with prices
→ spread = lowest ask price − highest bid price

**"Bet 10 TAB on YES in market X"**
→ get_market to confirm it exists and is open
→ prepare_buy(market_id, slot=0, amount_tab="10000000000000000000", user_address)
→ return TxCard for user to sign

**"What's my portfolio?"**
→ get_balance(address) for TAB balance
→ list_markets → for each: get_user_positions(market_id, address)

**"Which markets are trending?"**
→ list_markets to get titles
→ markets_with_buzz(market_titles=[...]) — $0.75, needs x402 payment

## Signing

Calldata signing happens in the user's environment, not via this skill:
- `cast send --private-key $PK --rpc-url $RPC <to> <data>` (foundry)
- `viem.walletClient.sendTransaction({ to, data, value })`
- `web3.eth.account.sign_transaction(...)` + `eth.send_raw_transaction(...)`

Always run all entries of `requires[]` in order before the main tx.
