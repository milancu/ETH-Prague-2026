"""Smoke + validation tests for `/markets`.

The on-chain `tx_verifier` dependency is overridden with a no-op so tests
never need a live RPC. Schema is recreated per test via the autouse fixture
already used elsewhere; we redeclare it here for isolation.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine
from api.main import app
from api.services.tx_verifier import TxVerificationError, get_tx_verifier


def _binary_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "market_id": 0,
        "condition_id": "0x" + "3f" * 32,
        "tx_hash": "0x" + "ab" * 32,
        "chain_id": 31337,
        "creator": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "title": "Will BTC exceed $100k before end of 2026?",
        "description": "Tracks BTC/USD price on major exchanges.",
        "rules": "Resolves YES if CoinGecko BTC/USD daily close exceeds 100,000.",
        "category": "Finance",
        "outcome_type": "binary",
        "outcomes": [{"label": "Yes"}, {"label": "No"}],
        "expires_at": "2026-12-31T23:59:59Z",
        "resolution_time": "2027-01-01T23:59:59Z",
    }
    payload.update(overrides)
    return payload


def _scalar_payload(**overrides: Any) -> dict[str, Any]:
    payload = _binary_payload(
        market_id=2,
        condition_id="0x" + "7c" * 32,
        tx_hash="0x" + "fe" * 32,
        title="What will ETH price be on Jan 1 2027?",
        category="Finance",
        outcome_type="scalar",
        outcomes=[{"label": "Higher"}, {"label": "Lower"}],
        scalar_min=500,
        scalar_max=20000,
        scalar_unit="USD",
        current_value=3200,
    )
    payload.update(overrides)
    return payload


async def _ok_verifier(chain_id: int, tx_hash: str) -> None:
    return None


async def _fail_verifier(chain_id: int, tx_hash: str) -> None:
    raise TxVerificationError("transaction not found")


@pytest.fixture(autouse=True)
async def _create_schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture(autouse=True)
def _override_verifier() -> AsyncIterator[None]:
    app.dependency_overrides[get_tx_verifier] = lambda: _ok_verifier
    yield
    app.dependency_overrides.pop(get_tx_verifier, None)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_post_creates_market_returns_compact_response(
    client: AsyncClient,
) -> None:
    resp = await client.post("/v1/markets", json=_binary_payload())

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["market_id"] == 0
    assert body["status"] == "pending"
    assert "id" in body
    assert "created_at" in body


async def test_post_normalizes_creator_to_lowercase_and_persists_outcomes(
    client: AsyncClient,
) -> None:
    await client.post("/v1/markets", json=_binary_payload())

    detail = (await client.get("/v1/markets/0")).json()
    assert detail["creator"] == "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
    assert detail["outcomes"] == [{"label": "Yes"}, {"label": "No"}]
    assert detail["status"] == "pending"
    assert detail["ens_name"] == "will-btc-exceed-100k-before-end-of-2026.kowalski.eth"


async def test_datetime_fields_serialize_with_utc_z_suffix(
    client: AsyncClient,
) -> None:
    create = (await client.post("/v1/markets", json=_binary_payload())).json()
    assert create["created_at"].endswith("Z")

    detail = (await client.get("/v1/markets/0")).json()
    assert detail["expires_at"] == "2026-12-31T23:59:59Z"
    assert detail["resolution_time"] == "2027-01-01T23:59:59Z"
    assert detail["created_at"].endswith("Z")


async def test_post_duplicate_tx_hash_returns_409(client: AsyncClient) -> None:
    await client.post("/v1/markets", json=_binary_payload())
    dup = await client.post(
        "/v1/markets", json=_binary_payload(market_id=99)
    )
    assert dup.status_code == 409
    assert dup.json()["detail"] == "market already exists"


async def test_post_duplicate_market_id_returns_409(client: AsyncClient) -> None:
    await client.post("/v1/markets", json=_binary_payload())
    dup = await client.post(
        "/v1/markets",
        json=_binary_payload(
            tx_hash="0x" + "cd" * 32,
            condition_id="0x" + "9a" * 32,
        ),
    )
    assert dup.status_code == 409


async def test_post_rejects_unknown_chain_id_with_422(client: AsyncClient) -> None:
    resp = await client.post("/v1/markets", json=_binary_payload(chain_id=1))
    assert resp.status_code == 422


async def test_post_rejects_bad_condition_id_with_422(client: AsyncClient) -> None:
    resp = await client.post(
        "/v1/markets", json=_binary_payload(condition_id="0xdeadbeef")
    )
    assert resp.status_code == 422


async def test_post_rejects_failing_tx_verification_with_400(
    client: AsyncClient,
) -> None:
    app.dependency_overrides[get_tx_verifier] = lambda: _fail_verifier
    try:
        resp = await client.post("/v1/markets", json=_binary_payload())
    finally:
        app.dependency_overrides[get_tx_verifier] = lambda: _ok_verifier
    assert resp.status_code == 400
    assert "tx verification failed" in resp.json()["detail"]


async def test_get_market_not_found_returns_404(client: AsyncClient) -> None:
    resp = await client.get("/v1/markets/999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "market not found"


async def test_list_markets_filters_by_category_and_paginates(
    client: AsyncClient,
) -> None:
    await client.post("/v1/markets", json=_binary_payload())
    await client.post(
        "/v1/markets",
        json=_binary_payload(
            market_id=1,
            tx_hash="0x" + "11" * 32,
            condition_id="0x" + "22" * 32,
            category="Politics",
        ),
    )
    await client.post(
        "/v1/markets",
        json=_scalar_payload(
            market_id=2,
            tx_hash="0x" + "33" * 32,
            condition_id="0x" + "44" * 32,
        ),
    )

    all_resp = await client.get("/v1/markets")
    assert all_resp.status_code == 200
    all_body = all_resp.json()
    assert all_body["total"] == 3
    assert all_body["page"] == 1
    assert all_body["limit"] == 20

    finance_resp = await client.get("/v1/markets?category=Finance")
    finance_body = finance_resp.json()
    assert finance_body["total"] == 2
    assert {m["category"] for m in finance_body["markets"]} == {"Finance"}

    scalar_resp = await client.get("/v1/markets?outcome_type=scalar")
    scalar_body = scalar_resp.json()
    assert scalar_body["total"] == 1
    assert scalar_body["markets"][0]["scalar_min"] == 500.0

    page_resp = await client.get("/v1/markets?limit=2&page=2")
    page_body = page_resp.json()
    assert page_body["total"] == 3
    assert page_body["limit"] == 2
    assert page_body["page"] == 2
    assert len(page_body["markets"]) == 1
