"""CLOB order-book helpers shared by routes/orders.py and routes/markets.py.

Pricing convention (from docs/agents/ai_layer.md Appendix A.3):
  sell order — maker offers wPosition for TAB.
               implied_price = takerAmount / makerAmount   (TAB per token)
  buy  order — maker offers TAB for wPosition.
               implied_price = makerAmount / takerAmount   (TAB per token)

Best ask  = lowest sell-side implied price.
Best bid  = highest buy-side implied price.
"""

from __future__ import annotations

import time
from decimal import Decimal, InvalidOperation

from api.db.models import Order

# ---------------------------------------------------------------------------
# Price helpers
# ---------------------------------------------------------------------------


def implied_price(order: Order) -> Decimal | None:
    """Implied TAB-per-token price for a maker order.

    Returns None if amounts are zero (malformed order).
    """
    try:
        ma = Decimal(order.maker_amount)
        ta = Decimal(order.taker_amount)
    except InvalidOperation:
        return None

    if ma == 0 or ta == 0:
        return None

    # Determine side by checking which token is TAB vs position wrapper.
    # We don't have the TAB address here, so callers classify externally.
    # This function returns ta/ma (sell: makerToken=position, takerToken=TAB).
    return ta / ma


def classify_order(
    order: Order, tab_address: str
) -> tuple[str, Decimal | None]:
    """Return ('sell'|'buy'|'unknown', implied_price).

    sell — maker offers outcome token for TAB  (ask)
    buy  — maker offers TAB for outcome token  (bid)
    """
    tab = tab_address.lower()
    mt = order.maker_token.lower()
    tt = order.taker_token.lower()

    if mt != tab and tt == tab:
        # maker sells position for TAB — this is a sell/ask
        ma, ta = Decimal(order.maker_amount), Decimal(order.taker_amount)
        price = (ta / ma) if ma > 0 else None
        return "sell", price

    if mt == tab and tt != tab:
        # maker offers TAB for position — this is a buy/bid
        ma, ta = Decimal(order.maker_amount), Decimal(order.taker_amount)
        price = (ma / ta) if ta > 0 else None
        return "buy", price

    return "unknown", None


def is_live(order: Order) -> bool:
    """True if the order has not expired (time-only; no on-chain check)."""
    return order.expiry > int(time.time())


# ---------------------------------------------------------------------------
# Order-book aggregation
# ---------------------------------------------------------------------------


def build_orderbook(
    orders: list[Order],
    tab_address: str,
    slot_wrapper_map: dict[int, str],
) -> dict[str, list[dict[str, object]]]:
    """Build a bids/asks map keyed by outcome slot.

    `slot_wrapper_map` is {slot_index: wrapper_address_lower}.
    Returns { "bids": [...], "asks": [...] } — each list sorted by price.
    Each entry: {slot, side, maker, maker_amount, taker_amount, price, order_id}.
    """
    # Invert: wrapper_address → slot
    wrapper_to_slot: dict[str, int] = {
        v.lower(): k for k, v in slot_wrapper_map.items()
    }

    bids: list[dict[str, object]] = []
    asks: list[dict[str, object]] = []

    for order in orders:
        if not is_live(order):
            continue

        side, price = classify_order(order, tab_address)
        if side == "unknown" or price is None:
            continue

        # Identify which slot this order is for
        position_token = (
            order.maker_token if side == "sell" else order.taker_token
        ).lower()
        slot = wrapper_to_slot.get(position_token)
        if slot is None:
            continue  # token not in our known wrappers for this market

        entry: dict[str, object] = {
            "order_id": order.id,
            "slot": slot,
            "side": side,
            "maker": order.maker,
            "maker_amount": order.maker_amount,
            "taker_amount": order.taker_amount,
            "price": str(price),
            "expiry": order.expiry,
            "created_at": order.created_at,
        }

        if side == "sell":
            asks.append(entry)
        else:
            bids.append(entry)

    from api.lib.randomness import FifoSentinel, get_randomness_source

    source = get_randomness_source()

    if isinstance(source, FifoSentinel):
        asks.sort(key=lambda e: (Decimal(str(e["price"])), e["created_at"]))
        bids.sort(
            key=lambda e: (-Decimal(str(e["price"])), e["created_at"])
        )
    else:
        rng = source.fresh_random()

        def _shuffle_by_price(
            entries: list[dict[str, object]], *, reverse: bool = False
        ) -> list[dict[str, object]]:
            by_price: dict[Decimal, list[dict[str, object]]] = {}
            for entry in entries:
                p = Decimal(str(entry["price"]))
                by_price.setdefault(p, []).append(entry)
            result: list[dict[str, object]] = []
            for price in sorted(by_price.keys(), reverse=reverse):
                bucket = by_price[price]
                rng.shuffle(bucket)
                result.extend(bucket)
            return result

        asks = _shuffle_by_price(asks)
        bids = _shuffle_by_price(bids, reverse=True)

    return {"bids": bids, "asks": asks}


def find_best_asks(
    orders: list[Order],
    tab_address: str,
    wrapper_address: str,
    amount_tab: int,
) -> list[tuple[Order, int]]:
    """Find the cheapest sell orders that together fill `amount_tab` of TAB spend.

    Returns a list of (order, fill_maker_amount) pairs — the taker fills
    `fill_maker_amount` tokens from each order, spending at most its pro-rata TAB.

    Returns an empty list if there is insufficient liquidity.
    """
    wrapper = wrapper_address.lower()
    candidates: list[Order] = []
    for o in orders:
        if not is_live(o):
            continue
        if o.maker_token.lower() != wrapper:
            continue
        if o.taker_token.lower() != tab_address.lower():
            continue
        candidates.append(o)

    def _price(o: Order) -> Decimal:
        ma = Decimal(o.maker_amount)
        return Decimal(o.taker_amount) / ma if ma > 0 else Decimal("inf")

    from api.lib.randomness import FifoSentinel, get_randomness_source

    source = get_randomness_source()

    if isinstance(source, FifoSentinel):
        candidates.sort(key=lambda o: (_price(o), o.created_at))
    else:
        rng = source.fresh_random()
        by_price: dict[Decimal, list[Order]] = {}
        for o in candidates:
            by_price.setdefault(_price(o), []).append(o)
        candidates = []
        for price in sorted(by_price.keys()):
            bucket = by_price[price]
            rng.shuffle(bucket)
            candidates.extend(bucket)

    result: list[tuple[Order, int]] = []
    tab_remaining = amount_tab

    for order in candidates:
        if tab_remaining <= 0:
            break
        ma = int(order.maker_amount)
        ta = int(order.taker_amount)
        if ma == 0:
            continue

        # How many maker tokens can we buy with tab_remaining?
        # fill_maker = floor(tab_remaining * ma / ta), capped at ma
        # (tab cost = ceil(fill_maker * ta / ma))
        fill_maker = min(ma, (tab_remaining * ma) // ta) if ta > 0 else ma
        if fill_maker <= 0:
            continue

        tab_cost = (fill_maker * ta + ma - 1) // ma  # ceiling division
        result.append((order, fill_maker))
        tab_remaining -= tab_cost

    if tab_remaining > 0:
        # Insufficient liquidity — signal by returning empty
        return []

    return result
