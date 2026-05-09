"""Inbound x402 paywall server (§3.2 of docs/agents/ai_layer.md).

Agents pay us USDC on Base mainnet before intelligence endpoints run.
Verification and on-chain settlement are outsourced to the public
x402.org/facilitator — we never submit settlement transactions ourselves.

Env vars:
  X402_IN_WALLET_ADDRESS  — receive address for USDC (required to activate paywall)
  X402_FACILITATOR_URL    — override the public facilitator (default: x402.org)
  X402_PRICE_STANDARD     — price for /tweets, /reddit, /news, /analyze  (default $0.50)
  X402_PRICE_PREMIUM      — price for /markets-with-buzz   (default $0.75)
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from x402 import x402ResourceServer
from x402.http import FacilitatorConfig, HTTPFacilitatorClient
from x402.http.middleware.fastapi import payment_middleware
from x402.http.types import PaymentOption, RouteConfig, RoutesConfig
from x402.mechanisms.evm.exact import ExactEvmServerScheme

_NETWORK = "eip155:84532"  # Base Sepolia — facilitator supports 84532, not 8453
_FACILITATOR_URL = os.getenv("X402_FACILITATOR_URL", "https://x402.org/facilitator")
_STANDARD_PRICE = os.getenv("X402_PRICE_STANDARD", "$0.50")
_PREMIUM_PRICE = os.getenv("X402_PRICE_PREMIUM", "$0.75")

# FastAPI middleware callable type
_MiddlewareFn = Callable[
    [Request, Callable[[Request], Awaitable[Response]]], Awaitable[Response]
]

# Lazily-initialised singletons — created on first protected request so that
# missing env vars surface at request time, not at import/startup time.
_cached_server: x402ResourceServer | None = None
_cached_fn: _MiddlewareFn | None = None


def is_paywall_enabled() -> bool:
    """True when X402_IN_WALLET_ADDRESS is set and non-empty."""
    return bool(os.environ.get("X402_IN_WALLET_ADDRESS", ""))


def _build_server() -> x402ResourceServer:
    """Create and return the x402ResourceServer singleton (without initializing)."""
    global _cached_server
    if _cached_server is None:
        facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=_FACILITATOR_URL))
        _cached_server = x402ResourceServer(facilitator)
        _cached_server.register(_NETWORK, ExactEvmServerScheme())  # type: ignore[no-untyped-call]
    return _cached_server


def get_resource_server() -> x402ResourceServer:
    """Return the initialized x402ResourceServer singleton.

    Shared between REST middleware and MCP middleware so the facilitator
    handshake (initialize()) runs exactly once.

    Raises RuntimeError if X402_IN_WALLET_ADDRESS is not set.
    """
    if not is_paywall_enabled():
        raise RuntimeError(
            "X402_IN_WALLET_ADDRESS is not set — "
            "configure it before the paywall can verify payments"
        )
    return _build_server()


def _build_routes(pay_to: str) -> RoutesConfig:
    standard = PaymentOption(
        scheme="exact", network=_NETWORK, pay_to=pay_to, price=_STANDARD_PRICE
    )
    premium = PaymentOption(
        scheme="exact", network=_NETWORK, pay_to=pay_to, price=_PREMIUM_PRICE
    )
    return {
        "POST /v1/intelligence/tweets": RouteConfig(accepts=standard),
        "POST /v1/intelligence/reddit": RouteConfig(accepts=standard),
        "POST /v1/intelligence/news": RouteConfig(accepts=standard),
        "POST /v1/intelligence/analyze": RouteConfig(accepts=standard),
        "POST /v1/intelligence/markets-with-buzz": RouteConfig(accepts=premium),
    }


def get_middleware() -> _MiddlewareFn:
    """Return (lazily build) the x402 payment middleware function.

    Raises RuntimeError if X402_IN_WALLET_ADDRESS is not set.
    """
    global _cached_fn
    if _cached_fn is None:
        pay_to = os.environ.get("X402_IN_WALLET_ADDRESS", "")
        if not pay_to:
            raise RuntimeError(
                "X402_IN_WALLET_ADDRESS is not set — "
                "configure it before the paywall can verify payments"
            )
        server = _build_server()
        _cached_fn = payment_middleware(_build_routes(pay_to), server)
    return _cached_fn
