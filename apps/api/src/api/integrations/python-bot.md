# Integration: autonomous Python bot

For autonomous agents that hold their own keys and interact without human
review. Uses `httpx` + the official `x402` PyPI package + `eth_account`.

---

## Setup

```bash
pip install httpx 'x402[evm,httpx]>=2.9' eth-account web3
```

```python
import os
API = os.getenv("API_BASE_URL", "https://api.kowalski-market.com")
PK  = os.environ["BOT_PRIVATE_KEY"]   # 0x-prefixed
RPC = os.getenv("BASE_RPC_URL", "https://sepolia.base.org")
```

Required env vars: `BOT_PRIVATE_KEY`, optionally `API_BASE_URL`, `BASE_RPC_URL`.

---

## Pattern 1 — Free read

```python
import httpx, asyncio

async def list_markets() -> list[dict]:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{API}/v1/markets")
        r.raise_for_status()
        return r.json()["markets"]

asyncio.run(list_markets())
```

---

## Pattern 2 — Sign + broadcast a TxCard

```python
import asyncio, httpx
from eth_account import Account
from web3 import Web3

w3 = Web3(Web3.HTTPProvider(RPC))
acct = Account.from_key(PK)


async def buy(market_id: int, slot: int, amount_tab_wei: int) -> str:
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{API}/v1/prepare/buy", json={
            "market_id": market_id,
            "slot": slot,
            "amount_tab": str(amount_tab_wei),
            "user_address": acct.address,
        })
        r.raise_for_status()
        card = r.json()

    # Run all preconditions first, in order
    for pre in card["requires"]:
        await _send(pre["to"], pre["data"])

    return await _send(card["to"], card["data"], value=int(card["value"]))


async def _send(to: str, data: str, value: int = 0) -> str:
    nonce = w3.eth.get_transaction_count(acct.address)
    tx = {
        "to": Web3.to_checksum_address(to),
        "data": data,
        "value": value,
        "chainId": w3.eth.chain_id,
        "nonce": nonce,
        "gas": 500_000,
        "maxFeePerGas": w3.eth.gas_price * 2,
        "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
    }
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h, timeout=60)
    return h.hex()
```

For `prepare/sell`, sign the EIP-712 `typed_data` with
`acct.sign_typed_data(...)` and POST the signature to `/v1/orders`.

---

## Pattern 3 — Pay an x402-paywalled tool

The `x402HttpxClient` handles the 402 challenge → sign → retry transparently.

```python
from x402 import x402Client
from x402.http.clients.httpx import x402HttpxClient
from x402.mechanisms.evm.exact import ExactEvmScheme

client = x402Client()
client.register("eip155:*", ExactEvmScheme(signer=acct))

async def fetch_tweets(query: str) -> list[dict]:
    async with x402HttpxClient(client) as http:
        r = await http.post(
            f"{API}/v1/intelligence/tweets",
            json={"query": query, "max_items": 10},
            timeout=120.0,    # facilitator + Apify can be slow
        )
        r.raise_for_status()
        return r.json()["tweets"]
```

Same pattern works against the MCP server (`POST /mcp/`) — see the live test
in `apps/api/tests/test_mcp_smoke.py::test_mcp_paid_tool_round_trip`.

---

## Example end-to-end loop

```python
# "If there are >5 tweets in the last hour, bet 10 TAB on YES."
markets = await list_markets()
for m in markets:
    tweets = await fetch_tweets(m["title"])
    if len(tweets) > 5:
        h = await buy(m["market_id"], slot=1, amount_tab_wei=10 * 10**18)
        print(f"bet placed: {h}")
```

---

## Troubleshooting

- **`x402 facilitator returned non-200`** — the public facilitator at
  `x402.org/facilitator` is occasionally down; retry with backoff.
- **`insufficient funds for gas`** — `cast balance $ADDR --rpc-url $RPC`; top
  up from the Base Sepolia faucet.
- **`replacement transaction underpriced`** — your bot is sending faster than
  the previous tx confirms; track nonces yourself or call
  `w3.eth.get_transaction_count(addr, "pending")`.
- **`PaymentRequiredError: amount > max`** — `x402Client` has a default
  spend cap; raise it with `x402Client(config=x402ClientConfig(max_amount=...))`.
