# Integration: Claude Code (MCP)

Claude Code is a native MCP client. It can list our tools, show pricing, and
call them — for paywalled tools it will surface the 402 challenge to the user
or sign automatically if you've registered an x402 wallet.

---

## Install

```bash
claude mcp add --transport http prediction-market https://api.kowalski-market.com/mcp/
```

For local dev, point at your own backend instead:

```bash
claude mcp add --transport http prediction-market http://localhost:8000/mcp/
```

Verify the server is registered:

```bash
claude mcp list
```

---

## What Claude Code sees

Open a Claude Code session and type `/mcp` — you should see all 16 tools:

```
prediction-market
├── list_markets, get_market, get_market_orderbook, get_user_positions, get_tab_balance
├── prepare_buy, prepare_sell, prepare_create_market, prepare_claim, prepare_merge, prepare_cancel_order
└── fetch_tweets ($0.50), fetch_reddit ($0.50), fetch_news ($0.50), analyze_market ($0.50), markets_with_buzz ($0.75)
```

The `$X.XX` annotations come from each tool's `_meta.x402_price_usd`. Free
tools have no annotation.

---

## Required env vars (server side)

The Claude Code client itself needs no env vars. The backend needs:

- `X402_IN_WALLET_ADDRESS` — receive address for paywalled tools.
- `X402_OUT_WALLET_PK` — for the backend to pay Apify when intelligence tools
  are invoked.
- `BASE_RPC_URL` — chain reads.

Without `X402_IN_WALLET_ADDRESS`, paywalled tools will execute for free —
useful for local dev.

---

## Example prompts

English:

> "List all open prediction markets in the politics category."
> "What's the current orderbook for market #5?"
> "Build calldata to bet 10 TAB on YES in market #5 — wallet address 0x..."
> "Fetch the latest tweets about the Czech parliamentary elections." (paid)

Czech:

> "Vypiš aktivní trhy v kategorii politika."
> "Vsadit 10 TAB na ANO v marketu 5, peněženka 0x..."
> "Najdi tweety o blížících se volbách." (placené)

For `prepare_*` tools, Claude Code returns the `TxCard` JSON to you. **Sign
locally** — Claude Code does not have a built-in signer for our chain. Pipe
the result to `cast send` or to a Python signer (see `python-bot.md`).

---

## Paywalled tools

When you call a paywalled tool, the backend returns HTTP 402 with payment
requirements. Claude Code will:

1. If an x402 wallet is registered in your environment, sign and retry.
2. Otherwise, surface the requirements as a tool error and let you decide.

To register a wallet, set `X402_CLIENT_PK` in the environment Claude Code
runs in, or use Claude Code's MCP-level auth config when it lands.

---

## Troubleshooting

- **MCP server not visible** — `claude mcp list` should show it. If not,
  re-run `claude mcp add ...` and restart the session.
- **`502 Bad Gateway` on tool calls** — the backend is unreachable from where
  Claude Code is running. If Claude Code runs in WSL or a VM, use the host's
  routable IP instead of `localhost`.
- **All paywalled tools return 402** — expected without a wallet. Claude
  Code does not yet auto-sign x402 challenges in all transports; until then,
  call paid tools from a Python bot or via the REST endpoint with
  `x402HttpxClient`.
- **Tool descriptors missing prices** — restart the backend after setting
  `X402_PRICE_*` env vars; descriptors are computed on import.
