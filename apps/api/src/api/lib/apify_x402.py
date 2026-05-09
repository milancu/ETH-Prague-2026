"""Outbound x402 client for paying Apify actors (§3.1 of docs/agents/ai_layer.md).

The backend service wallet holds USDC on Base mainnet (eip155:8453) and pays
per-call.  When Apify returns 402, x402HttpxClient handles sign + retry
transparently via the ExactEvmScheme.

Env vars required:
  X402_OUT_WALLET_PK   — hex private key (0x-prefixed) for the service wallet
                         Must hold USDC on Base mainnet for Apify calls.
"""

from __future__ import annotations

import os

from eth_account import Account
from x402 import x402Client
from x402.http.clients.httpx import x402HttpxClient
from x402.mechanisms.evm.exact import ExactEvmScheme

_NETWORK = "eip155:8453"  # Base mainnet


class ApifyClientError(Exception):
    """Raised when the Apify call cannot be completed."""


def _build_x402_client() -> x402Client:
    """Build an x402Client signed with the service wallet."""
    pk = os.environ.get("X402_OUT_WALLET_PK", "")
    if not pk:
        raise ApifyClientError(
            "X402_OUT_WALLET_PK is not set — backend wallet required to pay Apify"
        )
    account = Account.from_key(pk)
    client = x402Client()
    # eth_account.LocalAccount is auto-wrapped by ExactEvmScheme
    client.register(_NETWORK, ExactEvmScheme(signer=account))
    return client


def build_apify_client() -> x402HttpxClient:
    """Return an httpx.AsyncClient that auto-pays x402 challenges from Apify."""
    return x402HttpxClient(_build_x402_client())
