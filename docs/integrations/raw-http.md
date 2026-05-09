# Integration: raw HTTP (`curl` + `cast`)

The first-principles guide. Every other integration is a wrapper around what's
shown here. If you understand this, you can integrate from any language.

Read [`docs/agents/ai_layer.md`](../agents/ai_layer.md) §3 + §4 for the full
spec. This guide is the recipe.

---

## Prerequisites

- A wallet (`cast wallet new` or any 0x-prefixed private key).
- Sepolia ETH for gas: <https://www.alchemy.com/faucets/base-sepolia>.
- Sepolia USDC for paywalled calls: <https://faucet.circle.com> (Base Sepolia).
- TABcoin: claim from the dApp's `TABcoin.claim()` once authorized.
- [`foundry`](https://getfoundry.sh) for `cast send`. Optional but recommended.

```bash
export API=http://localhost:8000
export RPC=https://sepolia.base.org
export PK=0x<your-private-key>     # 0x-prefixed
export ADDR=$(cast wallet address --private-key $PK)
```

---

## Pattern 1 — Free read

```bash
curl -s $API/v1/markets | jq
curl -s $API/v1/markets/5 | jq
curl -s $API/v1/markets/5/orderbook | jq
curl -s $API/v1/balance/$ADDR | jq
```

No auth, no payment. Use these to populate UI or feed an LLM.

---

## Pattern 2 — Build calldata, sign locally, broadcast

The backend never signs. It returns a `TxCard` with `to`/`data`/`value`/`chainId`.

```bash
# 1. Ask the API what to send
curl -s -X POST $API/v1/prepare/buy \
  -H 'Content-Type: application/json' \
  -d '{
    "market_id": 5,
    "slot": 1,
    "amount_tab": "10000000000000000000",
    "user_address": "'"$ADDR"'"
  }' | tee /tmp/txcard.json

# 2. Run any preconditions (e.g. TAB.approve)
PRE_TO=$(jq -r '.requires[0].to' /tmp/txcard.json)
PRE_DATA=$(jq -r '.requires[0].data' /tmp/txcard.json)
cast send --private-key $PK --rpc-url $RPC $PRE_TO $PRE_DATA

# 3. Send the main transaction
TO=$(jq -r '.to' /tmp/txcard.json)
DATA=$(jq -r '.data' /tmp/txcard.json)
cast send --private-key $PK --rpc-url $RPC $TO $DATA
```

Same pattern for `prepare/claim`, `prepare/merge`, `prepare/cancel-order`.

For `prepare/sell`, the response is an `OrderCard` with EIP-712 typed data:

```bash
curl -s -X POST $API/v1/prepare/sell -d '{...}' > /tmp/order.json
# Sign typed_data with eth_signTypedData_v4 (cast doesn't support this directly;
# use a Python or JS snippet — see python-bot.md).
```

---

## Pattern 3 — x402 paywall (intelligence endpoints)

```bash
# 1. First request — no payment header
curl -i -X POST $API/v1/intelligence/tweets \
  -H 'Content-Type: application/json' \
  -d '{"query": "Ethereum", "max_items": 5}'
#   HTTP/1.1 402 Payment Required
#   PAYMENT-REQUIRED: <base64 JSON>
#   {... requirements with accepts[] ...}

# 2. Decode the requirements, sign EIP-712 transferWithAuthorization for USDC
# 3. Retry with PAYMENT-SIGNATURE header
curl -X POST $API/v1/intelligence/tweets \
  -H 'Content-Type: application/json' \
  -H "PAYMENT-SIGNATURE: $SIGNED_PAYLOAD" \
  -d '{"query": "Ethereum", "max_items": 5}'
```

Doing the EIP-712 signing by hand from `bash` is impractical. Use the
[`x402` PyPI package](https://pypi.org/project/x402/) or
[`@coinbase/x402`](https://www.npmjs.com/package/@coinbase/x402) — see
`python-bot.md`.

---

## Troubleshooting

- **`502 calldata build failed`** — backend can't reach the chain RPC. Check
  `BASE_RPC_URL` server-side; on local Hardhat, the node must be running.
- **`404 market not found`** — register the market via `POST /v1/markets` with
  the on-chain tx hash before calling `prepare/*`.
- **`402` on a free endpoint** — should never happen; check
  `X402_IN_WALLET_ADDRESS` only set for paywalled intelligence routes.
- **Tx revert with "transfer amount exceeds allowance"** — you skipped the
  `requires[]` precondition. Run all entries of `requires` first, in order.
- **Out of gas** — Base Sepolia faucets are stingy; check `cast balance $ADDR`.
