"""Tests for CLOB tiebreaker: FIFO default vs SpaceComputer random."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from random import Random
from unittest.mock import patch

import pytest

from api.lib.randomness import FifoSentinel

TAB = "0x" + "aa" * 20
YES_WRAPPER = "0x" + "bb" * 20


class _Order:
    """Minimal Order stub matching the fields orderbook.py reads."""

    def __init__(
        self,
        *,
        id: str = "1",
        maker: str = "0x" + "11" * 20,
        taker: str = "0x" + "00" * 20,
        maker_token: str = YES_WRAPPER,
        taker_token: str = TAB,
        maker_amount: str = "10" + "0" * 18,
        taker_amount: str = "6" + "0" * 18,
        expiry: int | None = None,
        created_at: datetime | None = None,
    ) -> None:
        self.id = id
        self.maker = maker
        self.taker = taker
        self.maker_token = maker_token
        self.taker_token = taker_token
        self.maker_amount = maker_amount
        self.taker_amount = taker_amount
        self.expiry = expiry if expiry is not None else int(time.time()) + 3600
        self.created_at = created_at if created_at is not None else datetime.now(UTC)


_SAME_PRICE = "6" + "0" * 18  # price = 0.6 for all
_SAME_MA = "10" + "0" * 18


class _FakeRandom:
    """Deterministic RandomnessSource returning a seeded Random."""

    def __init__(self, seed: int = 42) -> None:
        self._seed = seed

    def fresh_random(self) -> Random:
        return Random(self._seed)


# ---------------------------------------------------------------------------
# 1. FIFO default — same price, deterministic by created_at
# ---------------------------------------------------------------------------


def test_fifo_tiebreaker_sorts_by_created_at() -> None:
    t0 = datetime(2025, 1, 1, tzinfo=UTC)
    orders = [
        _Order(id="late", created_at=t0 + timedelta(seconds=10),
               maker_amount=_SAME_MA, taker_amount=_SAME_PRICE),
        _Order(id="early", created_at=t0,
               maker_amount=_SAME_MA, taker_amount=_SAME_PRICE),
        _Order(id="mid", created_at=t0 + timedelta(seconds=5),
               maker_amount=_SAME_MA, taker_amount=_SAME_PRICE),
    ]

    with patch("api.lib.randomness.get_randomness_source", return_value=FifoSentinel()):
        from api.llm.tools.orderbook import find_best_asks

        fills = find_best_asks(
            orders=orders,  # type: ignore[arg-type]
            tab_address=TAB,
            wrapper_address=YES_WRAPPER,
            amount_tab=6 * 10**18,
        )

    assert len(fills) == 1
    assert fills[0][0].id == "early"


def test_fifo_is_deterministic_over_100_runs() -> None:
    t0 = datetime(2025, 1, 1, tzinfo=UTC)
    orders = [
        _Order(id="b", created_at=t0 + timedelta(seconds=1),
               maker_amount=_SAME_MA, taker_amount=_SAME_PRICE),
        _Order(id="a", created_at=t0,
               maker_amount=_SAME_MA, taker_amount=_SAME_PRICE),
    ]

    with patch("api.lib.randomness.get_randomness_source", return_value=FifoSentinel()):
        from api.llm.tools.orderbook import find_best_asks

        for _ in range(100):
            fills = find_best_asks(
                orders=list(orders),  # type: ignore[arg-type]
                tab_address=TAB,
                wrapper_address=YES_WRAPPER,
                amount_tab=6 * 10**18,
            )
            assert fills[0][0].id == "a"


# ---------------------------------------------------------------------------
# 2. RANDOM with deterministic seed — shuffle is reproducible
# ---------------------------------------------------------------------------


def test_random_tiebreaker_shuffles_same_price_bucket() -> None:
    t0 = datetime(2025, 1, 1, tzinfo=UTC)
    n = 10
    orders = [
        _Order(
            id=str(i),
            created_at=t0 + timedelta(seconds=i),
            maker_amount=_SAME_MA,
            taker_amount=_SAME_PRICE,
        )
        for i in range(n)
    ]
    fifo_order = [str(i) for i in range(n)]

    fake = _FakeRandom(seed=42)
    with patch("api.lib.randomness.get_randomness_source", return_value=fake):
        from api.llm.tools.orderbook import find_best_asks

        fills = find_best_asks(
            orders=list(orders),  # type: ignore[arg-type]
            tab_address=TAB,
            wrapper_address=YES_WRAPPER,
            amount_tab=6 * 10**18,
        )

    random_order = [f[0].id for f in fills]
    assert random_order != fifo_order, "random shuffle should differ from FIFO"

    fake2 = _FakeRandom(seed=42)
    with patch("api.lib.randomness.get_randomness_source", return_value=fake2):
        fills2 = find_best_asks(
            orders=list(orders),  # type: ignore[arg-type]
            tab_address=TAB,
            wrapper_address=YES_WRAPPER,
            amount_tab=6 * 10**18,
        )

    random_order2 = [f[0].id for f in fills2]
    assert random_order == random_order2, "same seed must be reproducible"


def test_random_still_respects_price_priority() -> None:
    """Cheaper orders must fill first even in random mode."""
    t0 = datetime(2025, 1, 1, tzinfo=UTC)
    cheap = _Order(id="cheap", created_at=t0,
                   maker_amount=_SAME_MA, taker_amount=str(5 * 10**18))
    expensive = _Order(id="expensive", created_at=t0,
                       maker_amount=_SAME_MA, taker_amount=str(8 * 10**18))

    fake = _FakeRandom(seed=99)
    with patch("api.lib.randomness.get_randomness_source", return_value=fake):
        from api.llm.tools.orderbook import find_best_asks

        fills = find_best_asks(
            orders=[expensive, cheap],  # type: ignore[arg-type]
            tab_address=TAB,
            wrapper_address=YES_WRAPPER,
            amount_tab=5 * 10**18,
        )

    assert fills[0][0].id == "cheap"


# ---------------------------------------------------------------------------
# 3. RANDOM without URL = RuntimeError at startup
# ---------------------------------------------------------------------------


def test_random_without_url_raises() -> None:
    fake_settings = type(
        "S",
        (),
        {
            "clob_match_tiebreaker": "random",
            "spacecomputer_api_url": None,
            "spacecomputer_api_key": None,
            "spacecomputer_seed_ttl_s": 30,
        },
    )()

    with pytest.raises(RuntimeError, match="SPACECOMPUTER_API_URL"):
        with patch("api.lib.settings.settings", fake_settings):
            from api.lib.randomness import get_randomness_source

            get_randomness_source()
