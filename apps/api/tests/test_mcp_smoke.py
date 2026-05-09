"""MCP server smoke tests.

Verifies:
1. tools/list returns all expected tools with correct _meta pricing.
2. Calling a paywalled tool without X-Payment returns HTTP 402 with the
   PAYMENT-REQUIRED header (V2 x402 client requirement).
3. (Live, skipped without TEST_X402_CLIENT_PK + a running server)
   Full round-trip: client pays $0.50 USDC, MCP returns tool result.

The fixtures use manual ASGI lifespan triggering because httpx.ASGITransport
does not send ASGI lifespan events automatically.

The session manager singleton in FastMCP can only be `run()` once per
instance, so the lifespan fixture is module-scoped.  Other test modules
that import `api.main.app` and try to drive its ASGI lifespan independently
will collide with this one — keep MCP tests in this file.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest

from api.main import app

# ---------------------------------------------------------------------------
# Expected tool surface
# ---------------------------------------------------------------------------

_FREE_TOOLS = {
    "list_markets",
    "get_market",
    "get_market_orderbook",
    "get_user_positions",
    "get_tab_balance",
    "prepare_buy",
    "prepare_sell",
    "prepare_create_market",
    "prepare_claim",
    "prepare_merge",
    "prepare_cancel_order",
}

_PAYWALLED_PRICES = {
    "fetch_tweets": 0.50,
    "fetch_reddit": 0.50,
    "fetch_news": 0.50,
    "analyze_market": 0.50,
    "markets_with_buzz": 0.75,
}

# ---------------------------------------------------------------------------
# Shared lifespan fixture
# ---------------------------------------------------------------------------


def _rpc(method: str, params: dict[str, Any], id_: int = 1) -> bytes:
    return json.dumps(
        {"jsonrpc": "2.0", "id": id_, "method": method, "params": params}
    ).encode()


_INIT_BODY = _rpc(
    "initialize",
    {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "smoke-test", "version": "0.1"},
    },
)

_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


@pytest.fixture(scope="module")
async def mcp_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Start the FastAPI app lifespan once and yield an httpx client."""
    scope = {"type": "lifespan", "asgi": {"version": "3.0"}}
    started: asyncio.Event = asyncio.Event()
    shutdown: asyncio.Event = asyncio.Event()

    async def receive() -> dict[str, str]:
        if not started.is_set():
            started.set()
            return {"type": "lifespan.startup"}
        await shutdown.wait()
        return {"type": "lifespan.shutdown"}

    async def send(event: dict[str, str]) -> None:
        pass

    lifespan_task: asyncio.Task[None] = asyncio.create_task(
        app(scope, receive, send)  # type: ignore[arg-type]
    )
    await asyncio.sleep(0.3)  # wait for startup to complete

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://localhost:8000"
    ) as client:
        yield client

    shutdown.set()
    try:
        await asyncio.wait_for(lifespan_task, timeout=5.0)
    except (TimeoutError, asyncio.CancelledError):
        pass


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mcp_tools_list_contains_all_tools(
    mcp_client: httpx.AsyncClient,
) -> None:
    """tools/list must return all free + paywalled tools with correct _meta."""
    await mcp_client.post("/mcp/", content=_INIT_BODY, headers=_HEADERS)
    resp = await mcp_client.post(
        "/mcp/",
        content=_rpc("tools/list", {}, id_=2),
        headers=_HEADERS,
    )

    assert resp.status_code == 200
    data_line = next(
        line for line in resp.text.splitlines() if line.startswith("data:")
    )
    payload = json.loads(data_line[len("data:"):].strip())
    tools_by_name = {t["name"]: t for t in payload["result"]["tools"]}

    for name in _FREE_TOOLS:
        assert name in tools_by_name, f"free tool {name!r} missing from tools/list"

    for name, price in _PAYWALLED_PRICES.items():
        assert name in tools_by_name, f"paywalled tool {name!r} missing from tools/list"
        meta = tools_by_name[name].get("_meta", {})
        assert meta.get("x402_price_usd") == price, (
            f"{name}: expected x402_price_usd={price}, got {meta}"
        )


@pytest.mark.asyncio
async def test_mcp_paywalled_tool_returns_402_without_payment(
    mcp_client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Calling a paywalled tool without X-Payment must return HTTP 402."""
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", "0x" + "ab" * 20)

    await mcp_client.post("/mcp/", content=_INIT_BODY, headers=_HEADERS)
    resp = await mcp_client.post(
        "/mcp/",
        content=_rpc(
            "tools/call",
            {"name": "fetch_tweets", "arguments": {"query": "test"}},
            id_=3,
        ),
        headers=_HEADERS,
    )

    assert resp.status_code == 402, f"expected 402, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert "accepts" in body, f"402 body must contain payment requirements, got: {body}"
    # V2 x402 clients parse the PAYMENT-REQUIRED header first; without it,
    # the client raises ValueError("Invalid payment required response").
    assert resp.headers.get("PAYMENT-REQUIRED"), (
        "402 response must include PAYMENT-REQUIRED header for V2 client compatibility"
    )


# ---------------------------------------------------------------------------
# Live end-to-end round-trip — skipped unless TEST_X402_CLIENT_PK is set
# and a uvicorn server is running at TEST_API_BASE_URL.
# Requires:
#   TEST_X402_CLIENT_PK     — 0x-prefixed PK with USDC on Base Sepolia
#   X402_IN_WALLET_ADDRESS  — set on the running server
#   X402_OUT_WALLET_PK      — set so backend can call Apify
#   TEST_API_BASE_URL       — defaults to http://127.0.0.1:8000
# ---------------------------------------------------------------------------

_LIVE_SKIP = pytest.mark.skipif(
    not os.environ.get("TEST_X402_CLIENT_PK"),
    reason="TEST_X402_CLIENT_PK not set — skipping live MCP x402 round-trip test",
)


@_LIVE_SKIP
@pytest.mark.asyncio
async def test_mcp_paid_tool_round_trip() -> None:
    """Full e2e: MCP client pays $0.50 USDC → fetch_tweets returns result.

    Drives the same x402HttpxClient used in test_x402_inbound.py against
    POST /mcp/ with a tools/call JSON-RPC body.  Verifies the full
    challenge → sign → retry → tool-result + settle path.
    """
    from eth_account import Account
    from x402 import x402Client
    from x402.http.clients.httpx import x402HttpxClient
    from x402.mechanisms.evm.exact import ExactEvmScheme

    client_pk = os.environ["TEST_X402_CLIENT_PK"]
    account = Account.from_key(client_pk)

    x402_client = x402Client()
    x402_client.register("eip155:*", ExactEvmScheme(signer=account))

    api_base = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")

    rpc_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "fetch_tweets",
                "arguments": {"query": "Ethereum price", "max_items": 5},
            },
        }
    ).encode()

    async with x402HttpxClient(x402_client) as http:
        # Default httpx read timeout (5s) is too short — the chain is
        # facilitator verify + Sepolia settle + Apify outbound scrape.
        resp = await http.post(
            f"{api_base}/mcp/",
            content=rpc_body,
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            },
            timeout=120.0,
        )

    assert resp.status_code == 200, (
        f"expected 200, got {resp.status_code}: {resp.text[:400]}"
    )
    # Settlement confirmation header must be present after a paid round-trip.
    assert resp.headers.get("PAYMENT-RESPONSE"), (
        "200 response after paid call must include PAYMENT-RESPONSE header"
    )
    # SSE response — the tool result is in a `data:` line.
    data_line = next(
        line for line in resp.text.splitlines() if line.startswith("data:")
    )
    payload = json.loads(data_line[len("data:"):].strip())
    # Tool result should be a successful call_tool response, not an error.
    assert "result" in payload, f"unexpected JSON-RPC payload: {payload}"
    assert payload["result"].get("isError") is not True, (
        f"tool returned error: {payload['result']}"
    )
