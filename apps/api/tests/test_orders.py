"""Smoke tests for `/orders`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.session import engine
from api.main import app


def _sample_order_payload() -> dict[str, Any]:
    """Valid POST body — values come from a real scaffold CSV row."""
    return {
        "maker": "0x92e30b6a54911a3385bcd69f2dec998a13ef692f",
        "taker": "0x0000000000000000000000000000000000000000",
        "makerToken": "0x14b8043a318a25392f14e436db794a45cb1f64cd",
        "takerToken": "0x914abaf12180776c5652d30851b78ff0ee8d6e49",
        "makerAmount": "10000000000000000000",
        "takerAmount": "5000000000000000000",
        "expiry": 1778320053,
        "salt": "113040385241786510312279646310694185540",
        "chainId": 31337,
        "verifyingContract": "0x965d197cd94e0c8bf1fd3acc6eebe414758c53b5",
        "signature": (
            "0xe9567fa421619fbfec5aca50822f00f0b9c006bd91c07be49c0fbf5ded0cd777"
            "6486a40b005fe1233b64183a513298e6d38af5fb5404736adae701d03a7776c61c"
        ),
    }


@pytest.fixture(autouse=True)
async def _create_schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_post_creates_order_with_server_generated_id_and_created_at(
    client: AsyncClient,
) -> None:
    payload = _sample_order_payload()

    response = await client.post("/orders", json=payload)

    assert response.status_code == 201, response.text
    body = response.json()
    assert "id" in body and "-" in body["id"]
    assert "createdAt" in body
    assert body["maker"] == payload["maker"]
    assert body["makerAmount"] == payload["makerAmount"]
    assert body["chainId"] == payload["chainId"]


async def test_post_then_get_then_delete_round_trip(client: AsyncClient) -> None:
    post_resp = await client.post("/orders", json=_sample_order_payload())
    assert post_resp.status_code == 201
    order_id = post_resp.json()["id"]

    list_resp = await client.get("/orders")
    assert list_resp.status_code == 200
    assert any(o["id"] == order_id for o in list_resp.json())

    one_resp = await client.get(f"/orders/{order_id}")
    assert one_resp.status_code == 200
    assert one_resp.json()["id"] == order_id

    del_resp = await client.delete(f"/orders/{order_id}")
    assert del_resp.status_code == 204

    after_resp = await client.get("/orders")
    assert after_resp.status_code == 200
    assert all(o["id"] != order_id for o in after_resp.json())

    miss_resp = await client.get(f"/orders/{order_id}")
    assert miss_resp.status_code == 404


async def test_post_with_truncated_signature_returns_422(
    client: AsyncClient,
) -> None:
    payload = _sample_order_payload()
    payload["signature"] = "0xdeadbeef"  # too short

    response = await client.post("/orders", json=payload)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("signature" in str(err.get("loc", [])) for err in detail)
