"""Tests for CLOB order-book pricing logic in llm/tools/orderbook.py.

These cover the non-trivial math: price classification, best-ask selection,
partial fill accounting, and insufficient-liquidity detection.
"""

from __future__ import annotations

import time
from decimal import Decimal

import pytest

from api.llm.tools.orderbook import (
    build_orderbook,
    classify_order,
    find_best_asks,
    is_live,
)

TAB = "0x" + "aa" * 20
YES_WRAPPER = "0x" + "bb" * 20
NO_WRAPPER = "0x" + "cc" * 20

_UINT64_MAX = (1 << 64) - 1


# ---------------------------------------------------------------------------
# Minimal Order stub
# ---------------------------------------------------------------------------


class _Order:
    """Fake DB Order with just the fields orderbook.py reads."""

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
        market_id: int | None = 1,
        salt: str = "0",
        chain_id: int = 31337,
        verifying_contract: str = "0x" + "dd" * 20,
        signature: str = "0x" + "ee" * 65,
    ) -> None:
        self.id = id
        self.maker = maker
        self.taker = taker
        self.maker_token = maker_token
        self.taker_token = taker_token
        self.maker_amount = maker_amount
        self.taker_amount = taker_amount
        self.expiry = expiry if expiry is not None else int(time.time()) + 3600
        self.market_id = market_id
        self.salt = salt
        self.chain_id = chain_id
        self.verifying_contract = verifying_contract
        self.signature = signature


# ---------------------------------------------------------------------------
# is_live
# ---------------------------------------------------------------------------


def test_is_live_future_expiry() -> None:
    o = _Order(expiry=int(time.time()) + 100)
    assert is_live(o) is True


def test_is_live_past_expiry() -> None:
    o = _Order(expiry=int(time.time()) - 1)
    assert is_live(o) is False


# ---------------------------------------------------------------------------
# classify_order
# ---------------------------------------------------------------------------


def test_classify_sell_order() -> None:
    o = _Order(maker_token=YES_WRAPPER, taker_token=TAB)
    side, price = classify_order(o, TAB)
    assert side == "sell"
    # taker_amount / maker_amount = 6e18 / 10e18 = 0.6
    assert price == Decimal("6" + "0" * 18) / Decimal("10" + "0" * 18)


def test_classify_buy_order() -> None:
    # maker offers TAB for YES — this is a bid
    o = _Order(maker_token=TAB, taker_token=YES_WRAPPER)
    o.maker_amount = "6" + "0" * 18  # TAB
    o.taker_amount = "10" + "0" * 18  # YES tokens expected
    side, price = classify_order(o, TAB)
    assert side == "buy"
    # maker_amount / taker_amount = 6e18 / 10e18 = 0.6
    assert price == Decimal("6" + "0" * 18) / Decimal("10" + "0" * 18)


def test_classify_unknown_when_both_not_tab() -> None:
    o = _Order(maker_token=YES_WRAPPER, taker_token=NO_WRAPPER)
    side, price = classify_order(o, TAB)
    assert side == "unknown"


def test_classify_is_case_insensitive() -> None:
    o = _Order(maker_token=YES_WRAPPER.upper(), taker_token=TAB.upper())
    side, price = classify_order(o, TAB)
    assert side == "sell"


# ---------------------------------------------------------------------------
# find_best_asks
# ---------------------------------------------------------------------------

_10E18 = 10 * 10**18
_6E18 = 6 * 10**18
_5E18 = 5 * 10**18


def test_find_best_asks_single_order_sufficient() -> None:
    # 1 order: sell 10 YES for 6 TAB → price 0.6
    order = _Order(maker_amount=str(_10E18), taker_amount=str(_6E18))
    fills = find_best_asks(
        orders=[order],
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=_6E18,
    )
    assert len(fills) == 1
    _, fill_maker = fills[0]
    assert fill_maker == _10E18


def test_find_best_asks_partial_fill() -> None:
    # Want only 3 TAB → should fill 5 YES tokens (3/0.6 = 5)
    order = _Order(maker_amount=str(_10E18), taker_amount=str(_6E18))
    fills = find_best_asks(
        orders=[order],
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=3 * 10**18,
    )
    assert len(fills) == 1
    _, fill_maker = fills[0]
    assert fill_maker == 5 * 10**18


def test_find_best_asks_insufficient_liquidity_returns_empty() -> None:
    # Only 6 TAB of liquidity but we want 10 TAB worth
    order = _Order(maker_amount=str(_10E18), taker_amount=str(_6E18))
    fills = find_best_asks(
        orders=[order],
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=10 * 10**18,
    )
    assert fills == []


def test_find_best_asks_expired_order_ignored() -> None:
    expired = _Order(expiry=int(time.time()) - 1)
    fills = find_best_asks(
        orders=[expired],
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=_6E18,
    )
    assert fills == []


def test_find_best_asks_picks_cheapest_first() -> None:
    # Two orders: cheap (0.5 each) and expensive (0.7 each)
    cheap = _Order(
        id="cheap",
        maker_amount=str(_10E18),
        taker_amount=str(_5E18),  # 0.5 price
    )
    expensive = _Order(
        id="expensive",
        maker_amount=str(_10E18),
        taker_amount=str(7 * 10**18),  # 0.7 price
    )
    fills = find_best_asks(
        orders=[expensive, cheap],  # reversed to test sort
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=_5E18,
    )
    assert len(fills) == 1
    filled_order, _ = fills[0]
    assert filled_order.id == "cheap"


def test_find_best_asks_wrong_wrapper_ignored() -> None:
    order = _Order(maker_token=NO_WRAPPER)  # wrong wrapper
    fills = find_best_asks(
        orders=[order],
        tab_address=TAB,
        wrapper_address=YES_WRAPPER,
        amount_tab=_6E18,
    )
    assert fills == []


# ---------------------------------------------------------------------------
# build_orderbook
# ---------------------------------------------------------------------------


def test_build_orderbook_separates_bids_and_asks() -> None:
    ask = _Order(id="ask", maker_token=YES_WRAPPER, taker_token=TAB)
    bid = _Order(
        id="bid",
        maker_token=TAB,
        taker_token=YES_WRAPPER,
        maker_amount=str(_6E18),
        taker_amount=str(_10E18),
    )
    book = build_orderbook(
        orders=[ask, bid],
        tab_address=TAB,
        slot_wrapper_map={1: YES_WRAPPER},
    )
    assert len(book["asks"]) == 1
    assert len(book["bids"]) == 1
    assert book["asks"][0]["order_id"] == "ask"
    assert book["bids"][0]["order_id"] == "bid"


def test_build_orderbook_asks_sorted_cheapest_first() -> None:
    cheap = _Order(id="cheap", maker_amount=str(_10E18), taker_amount=str(_5E18))
    mid = _Order(id="mid", maker_amount=str(_10E18), taker_amount=str(_6E18))
    book = build_orderbook(
        orders=[mid, cheap],
        tab_address=TAB,
        slot_wrapper_map={1: YES_WRAPPER},
    )
    assert book["asks"][0]["order_id"] == "cheap"
    assert book["asks"][1]["order_id"] == "mid"


def test_build_orderbook_excludes_expired_orders() -> None:
    expired = _Order(expiry=int(time.time()) - 1)
    book = build_orderbook(
        orders=[expired],
        tab_address=TAB,
        slot_wrapper_map={1: YES_WRAPPER},
    )
    assert book["asks"] == []
    assert book["bids"] == []


def test_build_orderbook_unknown_wrapper_excluded() -> None:
    # wrapper not in slot_wrapper_map
    order = _Order(maker_token=NO_WRAPPER, taker_token=TAB)
    book = build_orderbook(
        orders=[order],
        tab_address=TAB,
        slot_wrapper_map={1: YES_WRAPPER},  # only YES registered
    )
    assert book["asks"] == []
