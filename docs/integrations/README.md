# Integration guides

Recipes for plugging the prediction-market backend into specific agent
platforms. Pick the one closest to your stack — they're all ~100 lines and
share the same underlying API surface.

| Guide | When to use it |
|---|---|
| [`raw-http.md`](./raw-http.md) | First-principles walkthrough with `curl` + `cast`. Read this first if you're integrating from any language. |
| [`python-bot.md`](./python-bot.md) | Autonomous Python agents that hold their own keys. Uses `httpx` + `x402` PyPI client + `eth-account`. |
| [`claude-code.md`](./claude-code.md) | Claude Code as an MCP client — direct connection to our `/mcp` endpoint with tool pricing visible. |
| [`openai-gpt.md`](./openai-gpt.md) | ChatGPT Custom GPT consuming our OpenAPI spec via Actions. Free endpoints only (Actions don't support x402). |
| [`openclaw.md`](./openclaw.md) | OpenClaw `SKILL.md` recipe — drop the file in `~/.openclaw/skills/` and the agent picks it up. |

| [`SKILL.md`](./SKILL.md) | Standalone skill file for agent platforms (OpenClaw, etc.). Drop into the agent's skills directory. |

## Public access

All guides are served from the live API:

```bash
# List available guides
curl https://api.kowalski-market.com/v1/integrations

# Fetch a specific guide
curl https://api.kowalski-market.com/v1/integrations/SKILL.md
curl https://api.kowalski-market.com/v1/integrations/raw-http.md
```

For the underlying spec — REST routes, MCP tool surface, x402 flows — see
[`docs/agents/ai_layer.md`](../agents/ai_layer.md).
