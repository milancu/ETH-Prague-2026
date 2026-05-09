# Integration: ChatGPT Custom GPT (Actions)

ChatGPT can call our REST API directly via the **Actions** feature on a
Custom GPT. This unlocks the free read + calldata-builder surface. Paywalled
intelligence endpoints are out of scope — ChatGPT Actions don't support the
x402 client flow yet, so the Custom GPT can only call free endpoints.

---

## Setup

1. Create a Custom GPT: <https://chatgpt.com/gpts/editor>.
2. **Configure → Actions → Create new action → Import from URL**:
   ```
   https://your-api-host/api/openapi.json
   ```
   (locally: `http://localhost:8000/api/openapi.json` — but ChatGPT's
   Actions need a public URL; use ngrok or a deployed server).
3. Authentication: **None**. The free endpoints don't need auth.
4. Save.

ChatGPT will list each route under the GPT's "Actions" menu. Test by typing:

> "List all markets."

It should call `GET /v1/markets` and render the result.

---

## Restrict scope (optional)

The OpenAPI spec exposes `paywall:x402` routes too. To prevent ChatGPT from
trying to call them (it'll fail with 402), filter the spec served to GPTs
or use Action Privacy → "user must approve each call".

The simplest path for the demo: serve a filtered OpenAPI document.

```python
# apps/api/src/api/main.py — add a filtered openapi route
from fastapi.openapi.utils import get_openapi

@app.get("/api/openapi.gpt.json", include_in_schema=False)
def openapi_gpt() -> dict:
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schema["paths"] = {
        p: m for p, m in schema["paths"].items()
        if "paywall:x402" not in str(m)
    }
    return schema
```

Point the GPT at `https://your-api-host/api/openapi.gpt.json`.

---

## Required env vars

None for ChatGPT itself. On the backend:

- `CORS_ORIGINS` — must include `https://chat.openai.com` if the GPT calls
  cross-origin (Actions usually use server-side calls so this isn't needed,
  but worth checking if you see preflight failures).

---

## Example prompts

The GPT's instructions should mention that it cannot sign transactions. A
useful instructions block:

```
You can read prediction-market data and build transaction calldata via the
Actions. You CANNOT sign or broadcast — when a user wants to bet, return
the TxCard to them and tell them to sign it in their wallet (e.g. via
MetaMask or `cast send`).

Money amounts are TAB unless explicitly stated. Reference markets by
marketId, never by raw address.

Free tools: list, get, get_orderbook, get_balance, prepare_*.
Paywalled tools (NOT available here): fetch_tweets, fetch_news, etc.
```

Example user turns:

> "What markets are open in sports?" → calls `list_markets?category=sports`.
> "Build me a buy of 10 TAB on YES in market 5, my address is 0x..." →
> calls `prepare/buy` and shows the TxCard. User pastes it into MetaMask.

---

## Troubleshooting

- **GPT says it can't reach the action** — ChatGPT Actions need a publicly
  reachable HTTPS URL. `localhost` won't work. Use ngrok / Cloudflare Tunnel.
- **`net::ERR_FAILED` in the action log** — CORS or HTTPS cert issue. Run
  the API behind HTTPS (Caddy is one-line, see `apps/api/CLAUDE.md`).
- **GPT calls a paywalled route and fails** — filter the OpenAPI spec
  (above) or update the GPT's instructions to forbid intelligence tools.
- **Action returns 422** — likely missing required field. Check the OpenAPI
  spec; ChatGPT sometimes elides required fields. Add them to the
  instructions block.
