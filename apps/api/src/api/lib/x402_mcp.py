"""MCP-specific inbound x402 paywall (§5 of docs/agents/ai_layer.md).

All MCP tool calls arrive as POST /mcp (JSON-RPC body).  The path-based
payment_middleware used for REST cannot differentiate per-tool because the
path is always the same.  Instead this middleware:

  1. Peeks at the buffered request body (Starlette caches it after one read).
  2. Identifies the JSON-RPC method and tool name.
  3. If the tool is paywalled and no X-PAYMENT header is present, returns HTTP
     402 with payment requirements in BOTH the JSON body and the
     PAYMENT-REQUIRED header — V2 x402 clients read the header first and only
     fall back to the body for V1 responses.
  4. If a valid X-PAYMENT header is present, verifies via the shared
     x402ResourceServer singleton (one facilitator handshake, shared with the
     REST paywall), then calls the handler, settles after the response, and
     emits a PAYMENT-RESPONSE header so the client can confirm settlement.

Choice documented here per §5 of ai_layer.md: HTTP-level middleware with
body peeking, rather than in-handler enforcement.  Body buffering is safe
because Starlette's BaseHTTPMiddleware caches request._body on first read
and replays it to downstream handlers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from x402 import ResourceConfig
from x402.http import (
    decode_payment_signature_header,
    encode_payment_required_header,
    encode_payment_response_header,
)
from x402.http.constants import (
    PAYMENT_REQUIRED_HEADER,
    PAYMENT_RESPONSE_HEADER,
    PAYMENT_SIGNATURE_HEADER,
    X_PAYMENT_HEADER,
)

from api.lib.x402_server import get_resource_server, is_paywall_enabled

_logger = logging.getLogger(__name__)


def _network() -> str:
    return os.getenv("X402_MCP_NETWORK", "eip155:84532")


def _standard_price() -> str:
    return os.getenv("X402_PRICE_STANDARD", "$0.50")


def _premium_price() -> str:
    return os.getenv("X402_PRICE_PREMIUM", "$0.75")


# Tool name → price tier ("standard" or "premium"). Resolved to a price string
# at request time via _standard_price() / _premium_price() so env-var changes
# (notably in tests) take effect without reimporting the module.
_PAYWALLED_TOOL_TIER: dict[str, str] = {
    "fetch_tweets": "standard",
    "fetch_reddit": "standard",
    "fetch_news": "standard",
    "analyze_market": "standard",
    "markets_with_buzz": "premium",
}


def _price_for(tool: str) -> str | None:
    tier = _PAYWALLED_TOOL_TIER.get(tool)
    if tier == "standard":
        return _standard_price()
    if tier == "premium":
        return _premium_price()
    return None


_init_lock = asyncio.Lock()
_server_initialized = False

_CallNext = Callable[[Request], Awaitable[Response]]


async def _ensure_initialized() -> None:
    global _server_initialized
    if _server_initialized:
        return
    async with _init_lock:
        if _server_initialized:
            return
        server = get_resource_server()
        if not getattr(server, "_initialized", False):
            server.initialize()
        _server_initialized = True


def _parse_tool_name(body: bytes) -> str | None:
    """Return the MCP tool name if body is a tools/call JSON-RPC request."""
    try:
        rpc: Any = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(rpc, dict):
        return None
    if rpc.get("method") != "tools/call":
        return None
    params = rpc.get("params")
    if not isinstance(params, dict):
        return None
    name = params.get("name")
    return name if isinstance(name, str) else None


async def mcp_x402_middleware(request: Request, call_next: _CallNext) -> Response:
    """HTTP middleware enforcing x402 payments for paywalled MCP tools."""
    if not is_paywall_enabled():
        return await call_next(request)

    # Only intercept POST /mcp (and /mcp/)
    if request.method != "POST" or request.url.path.rstrip("/") != "/mcp":
        return await call_next(request)

    body = await request.body()  # Starlette caches in request._body
    tool_name = _parse_tool_name(body)
    price = _price_for(tool_name) if tool_name else None
    if tool_name is None or price is None:
        return await call_next(request)

    # Ensure server is initialized (one-time facilitator handshake)
    try:
        await _ensure_initialized()
        server = get_resource_server()
    except RuntimeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)

    pay_to = os.environ["X402_IN_WALLET_ADDRESS"]
    config = ResourceConfig(
        scheme="exact", network=_network(), pay_to=pay_to, price=price
    )

    try:
        requirements = server.build_payment_requirements(config)
    except Exception as exc:
        return JSONResponse(
            {"error": f"payment requirements error: {exc}"}, status_code=503
        )

    payment_header = request.headers.get(X_PAYMENT_HEADER) or request.headers.get(
        PAYMENT_SIGNATURE_HEADER
    )

    if not payment_header:
        # 402 challenge: emit requirements in BOTH the PAYMENT-REQUIRED header
        # (V2 clients parse this first) and the JSON body (back-compat / debug).
        payment_required = server.create_payment_required_response(requirements)
        return JSONResponse(
            content=payment_required.model_dump(mode="json"),
            status_code=402,
            headers={
                PAYMENT_REQUIRED_HEADER: encode_payment_required_header(
                    payment_required
                )
            },
        )

    # Verify payment
    try:
        payload = decode_payment_signature_header(payment_header)
        verify = await server.verify_payment(payload, requirements[0])
    except Exception as exc:
        return JSONResponse(
            {"error": f"payment verification error: {exc}"}, status_code=402
        )

    if not verify.is_valid:
        return JSONResponse(
            {"error": "payment invalid", "reason": verify.invalid_reason},
            status_code=402,
        )

    # Execute handler
    response = await call_next(request)

    # Collect response body so we can settle and then re-emit a buffered Response.
    # MCP streamable HTTP returns SSE — body_iterator is present on the underlying
    # _StreamingResponse from BaseHTTPMiddleware; mypy sees only the Response base.
    body_iterator = getattr(response, "body_iterator", None)
    if body_iterator is not None:
        body_chunks = b""
        async for chunk in body_iterator:
            body_chunks += chunk if isinstance(chunk, bytes) else chunk.encode()
    else:
        body_chunks = response.body if isinstance(response.body, bytes) else b""

    # Settle payment. If settlement fails we MUST NOT deliver the result —
    # the client has a verified signature but no funds were captured.
    try:
        settle = await server.settle_payment(payload, requirements[0])
    except Exception as exc:
        _logger.error("x402 MCP settlement failed: %s", exc)
        return JSONResponse(
            {"error": "payment settlement failed", "detail": str(exc)},
            status_code=402,
        )

    if not settle.success:
        _logger.error(
            "x402 MCP settlement rejected: %s (%s)",
            settle.error_reason,
            settle.error_message,
        )
        return JSONResponse(
            {
                "error": "payment settlement failed",
                "reason": settle.error_reason,
                "message": settle.error_message,
            },
            status_code=402,
        )

    headers = dict(response.headers)
    headers[PAYMENT_RESPONSE_HEADER] = encode_payment_response_header(settle)
    # Drop content-length — re-emitted body may differ in size after rewrap.
    headers.pop("content-length", None)

    return Response(
        content=body_chunks,
        status_code=response.status_code,
        headers=headers,
        media_type=response.media_type,
    )
