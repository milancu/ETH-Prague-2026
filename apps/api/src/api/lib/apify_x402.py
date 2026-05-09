"""Outbound x402 client for paying Apify actors (§3.1 of docs/agents/ai_layer.md).

Apify ships its own x402 dialect: payment requirements are returned as a
base64-encoded `PAYMENT-REQUIRED` HTTP header (not a v2 PaymentRequired body),
and the only officially-supported signer is the `mcpc` Node CLI.  We therefore
implement the documented 3-step handshake manually with httpx + a subprocess
call to `mcpc x402 sign`.

The official `x402` PyPI package stays for inbound (Phase 3 — agents pay us);
it speaks the v2 spec which our own facilitator-backed endpoints will use.

Setup once per dev machine:
  npm install -g @apify/mcpc
  mcpc x402 import <X402_OUT_WALLET_PK>     # imports same key as in .env
  mcpc x402 info                             # confirms address

Env vars required:
  X402_OUT_WALLET_PK        — informational; mcpc holds its own copy of the key.
                              We still validate presence at startup so the
                              error message stays explicit.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, cast

import httpx

_PROTOCOL_HEADER = "X-APIFY-PAYMENT-PROTOCOL"
_PROTOCOL_VALUE = "X402"
_REQUIRED_HEADER = "PAYMENT-REQUIRED"
_SIGNATURE_HEADER = "PAYMENT-SIGNATURE"


class ApifyClientError(Exception):
    """Raised when the Apify call cannot be completed."""


def _ensure_wallet_configured() -> None:
    pk = os.environ.get("X402_OUT_WALLET_PK", "")
    if not pk:
        raise ApifyClientError(
            "X402_OUT_WALLET_PK is not set — backend wallet required to pay Apify"
        )


_SIGNATURE_MARKER = "PAYMENT-SIGNATURE header:"


async def _sign_with_mcpc(payment_required_header: str) -> str:
    """Shell out to `mcpc x402 sign` and return the base64 signature.

    mcpc emits a human-readable report with the signature on the line that
    follows the literal marker `PAYMENT-SIGNATURE header:`.  Anything else in
    stdout (status lines, MCP config snippet, Node warnings) is ignored.
    """
    process = await asyncio.create_subprocess_exec(
        "mcpc",
        "x402",
        "sign",
        payment_required_header,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_b, stderr_b = await process.communicate()
    if process.returncode != 0:
        raise ApifyClientError(
            f"`mcpc x402 sign` failed (exit {process.returncode}): "
            f"{stderr_b.decode(errors='replace').strip()[:300]}"
        )
    lines = stdout_b.decode(errors="replace").splitlines()
    for i, line in enumerate(lines):
        if _SIGNATURE_MARKER in line:
            for candidate in lines[i + 1 :]:
                stripped = candidate.strip()
                if stripped:
                    return stripped
            break
    raise ApifyClientError(
        "`mcpc x402 sign` output did not contain a PAYMENT-SIGNATURE header"
    )


async def run_actor_x402(
    base_url: str,
    actor_slug: str,
    input_data: dict[str, Any],
    timeout: float = 120.0,
) -> list[dict[str, Any]]:
    """Run an Apify actor via x402 and return the dataset items.

    Implements Apify's documented 3-step direct-API flow:
      1. Discovery: POST without signature, expect 402 + PAYMENT-REQUIRED header.
      2. Sign: shell to `mcpc x402 sign <header value>`.
      3. Payment: POST with both protocol and signature headers, expect 200.
    """
    _ensure_wallet_configured()
    # Apify treats `/` as a path separator; the API expects `~` in slugs.
    slug = actor_slug.replace("/", "~")
    url = f"{base_url.rstrip('/')}/v2/acts/{slug}/run-sync-get-dataset-items"

    async with httpx.AsyncClient(timeout=timeout) as client:
        # Step 1 — discovery
        discovery = await client.post(
            url,
            headers={_PROTOCOL_HEADER: _PROTOCOL_VALUE},
        )
        if discovery.status_code != 402:
            raise ApifyClientError(
                f"Apify actor {actor_slug!r} expected 402 on discovery, got "
                f"{discovery.status_code}: {discovery.text[:300]}"
            )
        payment_required = discovery.headers.get(_REQUIRED_HEADER)
        if not payment_required:
            raise ApifyClientError(
                f"Apify 402 response missing {_REQUIRED_HEADER} header"
            )

        # Step 2 — sign with mcpc
        signature = await _sign_with_mcpc(payment_required)

        # Step 3 — paid request
        paid = await client.post(
            url,
            headers={
                _PROTOCOL_HEADER: _PROTOCOL_VALUE,
                _SIGNATURE_HEADER: signature,
                "Content-Type": "application/json",
            },
            json=input_data,
        )

    if not 200 <= paid.status_code < 300:
        raise ApifyClientError(
            f"Apify actor {actor_slug!r} returned {paid.status_code} after "
            f"payment: {paid.text[:300]}"
        )

    data: Any = paid.json()
    if isinstance(data, list):
        return cast(list[dict[str, Any]], data)
    return cast(list[dict[str, Any]], data.get("items", data.get("data", [])))
