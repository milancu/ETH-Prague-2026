"""Integration tests for inbound x402 paywall on /v1/intelligence/*.

Two test levels:

  Unit (no network):
    - Without X402_IN_WALLET_ADDRESS set, paywall is skipped entirely and
      routes fall through to the intelligence handler (which 503s because
      X402_OUT_WALLET_PK triggers the Apify client, not needed here).
    - With X402_IN_WALLET_ADDRESS set but no PAYMENT-SIGNATURE header, the
      server returns 402 with a valid PaymentRequired body.

  End-to-end (requires live Base mainnet USDC wallet):
    Skipped unless TEST_X402_CLIENT_PK env var is set.
    Calls POST /v1/intelligence/tweets with a real x402 payment and
    asserts 200 + tweet data.
"""

from __future__ import annotations

import base64
import json
import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine
from api.lib import x402_server
from api.main import app

# ── Fixtures ─────────────────────────────────────────────────────────────────

RECEIVE_ADDR = "0x177FC5fc5BFd9c9C79291686c20376AF146aD13D"


@pytest.fixture(autouse=True)
async def _schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture(autouse=True)
def _reset_cached_middleware() -> AsyncIterator[None]:
    """Ensure each test starts with a fresh middleware singleton."""
    x402_server._cached_fn = None
    yield
    x402_server._cached_fn = None


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ── Paywall disabled (no X402_IN_WALLET_ADDRESS) ─────────────────────────────


async def test_no_wallet_skips_paywall(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("X402_IN_WALLET_ADDRESS", raising=False)
    # With paywall off, the request reaches the intelligence handler.
    # Handler will 503 (no Apify wallet) — but NOT 402.
    resp = await client.post(
        "/v1/intelligence/tweets", json={"query": "ETH", "max_items": 5}
    )
    assert resp.status_code != 402


# ── Paywall enabled — missing payment ────────────────────────────────────────


async def test_missing_payment_returns_402(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)
    resp = await client.post(
        "/v1/intelligence/tweets", json={"query": "ETH", "max_items": 5}
    )
    assert resp.status_code == 402


def _decode_payment_required(resp: object) -> dict[str, object]:
    """Decode the base64 payment-required header into a dict."""
    from httpx import Response as HttpxResponse

    assert isinstance(resp, HttpxResponse)
    header = resp.headers.get("payment-required", "")
    assert header, "missing payment-required header on 402"
    return json.loads(base64.b64decode(header))  # type: ignore[no-any-return]


async def test_402_header_contains_payment_requirements(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # x402 spec v2: payment requirements in base64 `payment-required` header
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)
    resp = await client.post(
        "/v1/intelligence/tweets", json={"query": "ETH", "max_items": 5}
    )
    assert resp.status_code == 402
    pr = _decode_payment_required(resp)
    assert "accepts" in pr
    assert pr.get("x402Version") == 2


async def test_402_price_matches_standard(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)
    resp = await client.post(
        "/v1/intelligence/tweets", json={"query": "ETH", "max_items": 5}
    )
    assert resp.status_code == 402
    pr = _decode_payment_required(resp)
    # amount "500000" = $0.50 USDC (6 decimals)
    amounts = [a.get("amount") for a in pr.get("accepts", [])]
    assert "500000" in amounts, f"expected amount 500000, got: {amounts}"


async def test_premium_endpoint_returns_402_with_higher_price(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)
    resp = await client.post(
        "/v1/intelligence/markets-with-buzz",
        json={"market_titles": ["Bitcoin ETF"], "max_tweets_per_market": 5},
    )
    assert resp.status_code == 402
    pr = _decode_payment_required(resp)
    # amount "750000" = $0.75 USDC
    amounts = [a.get("amount") for a in pr.get("accepts", [])]
    assert "750000" in amounts, f"expected amount 750000, got: {amounts}"


async def test_free_route_not_blocked_by_paywall(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Paywall must NOT intercept non-intelligence routes."""
    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)
    resp = await client.get("/health")
    assert resp.status_code == 200
    resp2 = await client.get("/v1/markets")
    assert resp2.status_code == 200


# ── Live end-to-end test (skipped unless TEST_X402_CLIENT_PK is set) ─────────

_LIVE_SKIP = pytest.mark.skipif(
    not os.environ.get("TEST_X402_CLIENT_PK"),
    reason="TEST_X402_CLIENT_PK not set — skipping live x402 payment test",
)


@_LIVE_SKIP
async def test_paid_request_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """Full e2e: client pays $0.50 USDC → gets tweets back.

    Requires:
      TEST_X402_CLIENT_PK     — 0x-prefixed PK with USDC on Base mainnet
      X402_IN_WALLET_ADDRESS  — set to the receive address
      X402_OUT_WALLET_PK      — set so the backend can call Apify
    """
    from eth_account import Account
    from x402 import x402Client
    from x402.http.clients.httpx import x402HttpxClient
    from x402.mechanisms.evm.exact import ExactEvmScheme

    monkeypatch.setenv("X402_IN_WALLET_ADDRESS", RECEIVE_ADDR)

    client_pk = os.environ["TEST_X402_CLIENT_PK"]
    account = Account.from_key(client_pk)

    x402_client = x402Client()
    x402_client.register("eip155:8453", ExactEvmScheme(signer=account))

    # Hit the REAL running server (not the in-process ASGI transport)
    api_base = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8000")

    async with x402HttpxClient(x402_client) as http:
        resp = await http.post(
            f"{api_base}/v1/intelligence/tweets",
            json={"query": "Ethereum price", "max_items": 5},
        )

    assert resp.status_code == 200, (
        f"expected 200, got {resp.status_code}: {resp.text[:400]}"
    )
    body = resp.json()
    assert "tweets" in body
    assert isinstance(body["tweets"], list)
