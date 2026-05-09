"""MCP server — adapter over the same tool implementations as the REST API.

Exposes the full tool surface (§4.1 + §4.2 of docs/agents/ai_layer.md) as MCP
tools.  No business logic lives here — handlers delegate to the same functions
used by routes/markets.py, routes/prepare.py, and routes/intelligence.py.

Transport: Streamable HTTP (POST /mcp).
Mount:     app.mount("/mcp", mcp.streamable_http_app()) in main.py.
Lifespan:  mcp.session_manager.run() included in the FastAPI lifespan context.

x402 pricing: exposed via tool descriptor _meta field so MCP clients can
display cost before invocation.  Runtime enforcement is handled by the HTTP
middleware in lib/x402_mcp.py before the request reaches this server.

Tool failures raise exceptions so FastMCP wraps the result with isError=true
in the JSON-RPC response.  Returning a dict with an "error" key would look
like a successful structured result to MCP clients, which is misleading.
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlmodel import col, func, select

from api.db.models import Market, Order
from api.db.session import SessionLocal
from api.lib.apify_x402 import ApifyClientError
from api.lib.web3_client import get_client
from api.llm.tools import apify as apify_tools
from api.llm.tools import chain as chain_tools
from api.llm.tools import prepare as prepare_tools
from api.llm.tools.chain import get_wrapper_address, index_set_for_slot
from api.llm.tools.orderbook import build_orderbook

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_DEFAULT_CHAIN_ID = int(os.getenv("CHAIN_ID", "31337"))


def _price_float(env_var: str, default: str) -> float:
    return float(os.getenv(env_var, default).lstrip("$"))


# x402 pricing exposed in tool descriptors. We include price + network only —
# pay_to is not pre-baked because it is environment-dependent and the 402
# challenge response carries it on every paywalled call.  Reading env vars at
# module load is acceptable because prices are static deployment config; tests
# that care about pricing should set env vars before importing this module.
_INTELLIGENCE_META_STANDARD: dict[str, Any] = {
    "x402_price_usd": _price_float("X402_PRICE_STANDARD", "$0.50"),
    "x402_network": os.getenv("X402_MCP_NETWORK", "eip155:84532"),
}
_INTELLIGENCE_META_PREMIUM: dict[str, Any] = {
    "x402_price_usd": _price_float("X402_PRICE_PREMIUM", "$0.75"),
    "x402_network": os.getenv("X402_MCP_NETWORK", "eip155:84532"),
}

_raw_hosts = os.getenv("MCP_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
_MCP_ALLOWED_HOSTS: list[str] = []
for _h in _raw_hosts:
    _h = _h.strip()
    if _h:
        _MCP_ALLOWED_HOSTS.append(_h)
        if ":" not in _h:
            _MCP_ALLOWED_HOSTS.append(f"{_h}:8000")

_INSTRUCTIONS = """\
Czech prediction-market dApp on Base Sepolia.  You have 16 tools split into \
three groups: free reads, free calldata builders, and paywalled intelligence.

## Hard rules
1. Never reference a market, price, or balance you did not get from a tool.
2. Never propose a transaction without calling a prepare_* tool first.
3. Reference markets by market_id (e.g. "market #5"), never raw addresses.
4. Money amounts are TAB (18 decimals). Show human-readable, not wei.
5. Czech or English — match the user.

## Common workflows

**"What's the bid-ask spread on market X?"**
→ list_markets to find the market_id
→ get_market_orderbook(market_id) — returns bids[] and asks[] with prices
→ spread = lowest ask price − highest bid price

**"Bet 10 TAB on YES in market X"**
→ list_markets or get_market to confirm market exists and is open
→ prepare_buy(market_id, slot=0, amount_tab="10000000000000000000", user_address)
→ return the TxCard for the user to sign

**"Sell my YES tokens at price 0.7"**
→ get_user_positions(market_id, address) to confirm holdings
→ prepare_sell(market_id, slot, maker_amount, taker_amount, user_address, expiry)
→ return the OrderCard — user signs EIP-712, then POST /v1/orders

**"Create a market: will BTC hit 200k by Dec 31?"**
→ prepare_create_market(name, description, category, outcome_type="binary", ...)
→ returns TxCard with TAB.approve precondition — user signs both

**"What's my portfolio?"**
→ get_tab_balance(address) for TAB balance
→ list_markets to get all markets
→ get_user_positions(market_id, address) for each relevant market

**"What's the Twitter buzz around market X?" (paywalled $0.50)**
→ get_market(market_id) to get the title
→ fetch_tweets(query=title) — costs $0.50 USDC, 402 challenge if unpaid

**"Which markets are trending?" (paywalled $0.75)**
→ list_markets to get titles
→ markets_with_buzz(market_titles=[...]) — costs $0.75 USDC

## Signing
You never sign transactions. prepare_* tools return calldata (TxCard or \
OrderCard). The user signs in their own wallet. If there are preconditions \
(requires[]), the user must sign those first, in order.

## x402 paywalled tools
Tools with x402_price_usd in their metadata cost USDC on Base Sepolia. \
Without a payment signature, the server returns HTTP 402 with payment \
requirements. Sign the challenge with an EVM wallet and retry.
"""

mcp = FastMCP(
    "Prediction Market Agent API",
    instructions=_INSTRUCTIONS,
    stateless_http=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(
        allowed_hosts=_MCP_ALLOWED_HOSTS,
    ),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_address(address: str, field: str = "address") -> None:
    if not _ADDR_RE.match(address):
        raise ValueError(f"{field} must be a 0x-prefixed 40-hex-char EVM address")


def _isoformat(dt: Any) -> str:
    return dt.isoformat(timespec="seconds") + "Z" if dt else ""


def _market_to_dict(m: Market) -> dict[str, Any]:
    return {
        "id": m.id,
        "market_id": m.market_id,
        "title": m.title,
        "description": m.description,
        "category": m.category,
        "outcome_type": m.outcome_type,
        "outcomes": m.outcomes,
        "status": m.status,
        "expires_at": _isoformat(m.expires_at),
        "resolution_time": _isoformat(m.resolution_time),
        "chain_id": m.chain_id,
        "condition_id": m.condition_id,
    }


def _outcome_labels(market: Market) -> list[str]:
    return [str(o.get("label", i)) for i, o in enumerate(market.outcomes)]


# ---------------------------------------------------------------------------
# Free read tools
# ---------------------------------------------------------------------------


@mcp.tool(
    description=(
        "List registered prediction markets. "
        "Filter by category, status, or outcome_type. "
        "Returns paginated results — use page/limit to navigate."
    )
)
async def list_markets(
    category: str | None = None,
    status: str | None = None,
    outcome_type: str | None = None,
    chain_id: int | None = None,
    page: int = 1,
    limit: int = 20,
) -> dict[str, Any]:
    async with SessionLocal() as session:
        base_stmt = select(Market)
        count_stmt = select(func.count()).select_from(Market)
        if category is not None:
            base_stmt = base_stmt.where(Market.category == category)
            count_stmt = count_stmt.where(Market.category == category)
        if status is not None:
            base_stmt = base_stmt.where(Market.status == status)
            count_stmt = count_stmt.where(Market.status == status)
        if outcome_type is not None:
            base_stmt = base_stmt.where(Market.outcome_type == outcome_type)
            count_stmt = count_stmt.where(Market.outcome_type == outcome_type)
        if chain_id is not None:
            base_stmt = base_stmt.where(Market.chain_id == chain_id)
            count_stmt = count_stmt.where(Market.chain_id == chain_id)

        total = (await session.execute(count_stmt)).scalar_one()
        page_stmt = (
            base_stmt.order_by(col(Market.created_at).desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        rows = list((await session.execute(page_stmt)).scalars().all())
        return {
            "markets": [_market_to_dict(m) for m in rows],
            "total": total,
            "page": page,
            "limit": limit,
        }


@mcp.tool(
    description=(
        "Get full metadata for one market by its on-chain integer market_id. "
        "Returns condition_id, outcomes, status, and timestamps."
    )
)
async def get_market(market_id: int) -> dict[str, Any]:
    async with SessionLocal() as session:
        stmt = select(Market).where(Market.market_id == market_id)
        market = (await session.execute(stmt)).scalar_one_or_none()
        if market is None:
            raise ValueError(f"market {market_id} not found")
        return _market_to_dict(market)


@mcp.tool(
    description=(
        "Get the live CLOB order book for a market. "
        "Returns bids and asks sorted by price, filtered for non-expired orders."
    )
)
async def get_market_orderbook(market_id: int) -> dict[str, Any]:
    async with SessionLocal() as session:
        stmt = select(Market).where(Market.market_id == market_id)
        market = (await session.execute(stmt)).scalar_one_or_none()
        if market is None:
            raise ValueError(f"market {market_id} not found")

        orders_stmt = select(Order).where(Order.market_id == market_id)
        db_orders: list[Order] = list(
            (await session.execute(orders_stmt)).scalars().all()
        )

        client = get_client(market.chain_id)
        slot_count = len(market.outcomes)

        def _get_wrappers() -> dict[int, str]:
            result: dict[int, str] = {}
            for slot in range(slot_count):
                index_set = index_set_for_slot(slot)
                addr = get_wrapper_address(client, market.condition_id, index_set)
                if addr:
                    result[slot] = addr
            return result

        try:
            slot_wrapper_map = await asyncio.to_thread(_get_wrappers)
        except Exception:
            slot_wrapper_map = {}

        tab_address = client.tab.address.lower()
        book = build_orderbook(db_orders, tab_address, slot_wrapper_map)
        return {"market_id": market_id, **book}


@mcp.tool(
    description=(
        "Get on-chain ERC-1155 and ERC-20 position balances for a user in a market. "
        "address must be a 0x-prefixed 40-hex-char EVM address."
    )
)
async def get_user_positions(market_id: int, address: str) -> dict[str, Any]:
    _check_address(address)
    async with SessionLocal() as session:
        stmt = select(Market).where(Market.market_id == market_id)
        market = (await session.execute(stmt)).scalar_one_or_none()
        if market is None:
            raise ValueError(f"market {market_id} not found")

        client = get_client(market.chain_id)
        labels = _outcome_labels(market)
        slot_count = len(market.outcomes)

        positions = await asyncio.to_thread(
            chain_tools.get_user_positions,
            client,
            market.condition_id,
            slot_count,
            address,
            labels,
        )

        return {
            "market_id": market_id,
            "address": address.lower(),
            "positions": positions,
        }


@mcp.tool(
    description=(
        "Get raw (wei) and formatted TABcoin balance for an address. "
        "address must be a 0x-prefixed 40-hex-char EVM address. "
        "chain_id defaults to the deployment's CHAIN_ID env var."
    )
)
async def get_tab_balance(
    address: str,
    chain_id: int | None = None,
) -> dict[str, Any]:
    _check_address(address)
    client = get_client(chain_id if chain_id is not None else _DEFAULT_CHAIN_ID)
    result = await asyncio.to_thread(chain_tools.get_tab_balance, client, address)
    return {"address": address.lower(), **result}


# ---------------------------------------------------------------------------
# Calldata builder tools (free — AI consent rule: returns calldata, never signs)
# ---------------------------------------------------------------------------


@mcp.tool(
    description=(
        "Build buy calldata for purchasing outcome tokens. "
        "Tries to fill from the CLOB order book; falls back to PMv2.splitAndWrap "
        "if insufficient liquidity. amount_tab is in wei (decimal string). "
        "Always uses market.chain_id — chain comes from the market, not the caller. "
        "Returns a TxCard — the agent signs and broadcasts; we never see a private key."
    )
)
async def prepare_buy(
    market_id: int,
    slot: int,
    amount_tab: str,
    user_address: str,
) -> dict[str, Any]:
    _check_address(user_address, field="user_address")
    async with SessionLocal() as session:
        stmt = select(Market).where(Market.market_id == market_id)
        market = (await session.execute(stmt)).scalar_one_or_none()
        if market is None:
            raise ValueError(f"market {market_id} not found")
        if slot >= len(market.outcomes):
            raise ValueError(
                f"slot {slot} out of range "
                f"(market has {len(market.outcomes)} outcomes)"
            )

        orders_stmt = select(Order).where(Order.market_id == market_id)
        db_orders: list[Order] = list(
            (await session.execute(orders_stmt)).scalars().all()
        )
        labels = _outcome_labels(market)
        client = get_client(market.chain_id)

        return await asyncio.to_thread(
            prepare_tools.prepare_buy,
            client,
            market_id,
            market.condition_id,
            slot,
            int(amount_tab),
            db_orders,
            market.chain_id,
            labels,
        )


@mcp.tool(
    description=(
        "Build EIP-712 typed data for a limit sell order on TabClob. "
        "The agent signs typed_data with eth_signTypedData_v4 "
        "and POSTs to POST /v1/orders. "
        "Always uses market.chain_id. "
        "Returns an OrderCard — we never see a private key."
    )
)
async def prepare_sell(
    market_id: int,
    slot: int,
    maker_amount: str,
    taker_amount: str,
    user_address: str,
    expiry: int,
) -> dict[str, Any]:
    _check_address(user_address, field="user_address")
    async with SessionLocal() as session:
        stmt = select(Market).where(Market.market_id == market_id)
        market = (await session.execute(stmt)).scalar_one_or_none()
        if market is None:
            raise ValueError(f"market {market_id} not found")
        if slot >= len(market.outcomes):
            raise ValueError(f"slot {slot} out of range")

        labels = _outcome_labels(market)
        client = get_client(market.chain_id)

        return await asyncio.to_thread(
            prepare_tools.prepare_sell,
            client,
            market_id,
            market.condition_id,
            slot,
            int(maker_amount),
            int(taker_amount),
            user_address,
            expiry,
            market.chain_id,
            labels,
        )


@mcp.tool(
    description=(
        "Build createMarket calldata for PredictionMarketV2. "
        "outcome_type: 'binary' | 'multi' | 'scalar'. "
        "chain_id defaults to the deployment's CHAIN_ID env var. "
        "Returns a TxCard with a TAB.approve precondition — agent signs both."
    )
)
async def prepare_create_market(
    name: str,
    description: str,
    category: str,
    outcome_type: Literal["binary", "multi", "scalar"],
    outcome_slot_count: int,
    outcome_labels: list[str],
    oracle: str,
    expires_at: int,
    resolution_time: int,
    chain_id: int | None = None,
) -> dict[str, Any]:
    _check_address(oracle, field="oracle")
    _OUTCOME_TYPE_INT = {"binary": 0, "multi": 1, "scalar": 2}
    effective_chain = chain_id if chain_id is not None else _DEFAULT_CHAIN_ID
    client = get_client(effective_chain)
    return await asyncio.to_thread(
        prepare_tools.prepare_create_market,
        client,
        name,
        description,
        category,
        _OUTCOME_TYPE_INT[outcome_type],
        outcome_slot_count,
        outcome_labels,
        oracle,
        expires_at,
        resolution_time,
        effective_chain,
    )


@mcp.tool(
    description=(
        "Build claimWinnings calldata for a resolved market. "
        "index_sets: list of winning outcome indexSets to redeem. "
        "chain_id defaults to the deployment's CHAIN_ID env var. "
        "Returns a TxCard with CT.setApprovalForAll precondition."
    )
)
async def prepare_claim(
    market_id: int,
    index_sets: list[int],
    chain_id: int | None = None,
) -> dict[str, Any]:
    effective_chain = chain_id if chain_id is not None else _DEFAULT_CHAIN_ID
    client = get_client(effective_chain)
    return await asyncio.to_thread(
        prepare_tools.prepare_claim,
        client,
        market_id,
        index_sets,
        effective_chain,
    )


@mcp.tool(
    description=(
        "Build mergeFrom calldata to recover TAB by burning a full position set. "
        "partition defaults to [1, 2] for binary markets. amount is in wei (string). "
        "chain_id defaults to the deployment's CHAIN_ID env var."
    )
)
async def prepare_merge(
    market_id: int,
    amount: str,
    partition: list[int] | None = None,
    chain_id: int | None = None,
) -> dict[str, Any]:
    if partition is None:
        partition = [1, 2]
    effective_chain = chain_id if chain_id is not None else _DEFAULT_CHAIN_ID
    client = get_client(effective_chain)
    return await asyncio.to_thread(
        prepare_tools.prepare_merge,
        client,
        market_id,
        partition,
        int(amount),
        effective_chain,
    )


@mcp.tool(
    description=(
        "Build TabClob.cancel calldata for an existing maker order by order_id. "
        "chain_id defaults to the deployment's CHAIN_ID env var."
    )
)
async def prepare_cancel_order(
    order_id: str,
    chain_id: int | None = None,
) -> dict[str, Any]:
    async with SessionLocal() as session:
        order = await session.get(Order, order_id)
        if order is None:
            raise ValueError(f"order {order_id!r} not found")
        effective_chain = chain_id if chain_id is not None else _DEFAULT_CHAIN_ID
        client = get_client(effective_chain)
        return await asyncio.to_thread(
            prepare_tools.prepare_cancel_order,
            client,
            order,
            effective_chain,
        )


# ---------------------------------------------------------------------------
# Intelligence tools — paywalled via x402 ($0.50–$0.75 USDC on Base Sepolia)
# Runtime enforcement: HTTP middleware in lib/x402_mcp.py intercepts the
# tools/call request before FastMCP processes it and issues HTTP 402.
# ---------------------------------------------------------------------------


@mcp.tool(
    description=(
        "Fetch recent tweets for a search query via Apify. "
        "Paywalled: $0.50 USDC on Base Sepolia (eip155:84532) per call. "
        "The middleware will issue HTTP 402 if X-Payment header is absent."
    ),
    meta=_INTELLIGENCE_META_STANDARD,
)
async def fetch_tweets(query: str, max_items: int = 20) -> dict[str, Any]:
    try:
        return await apify_tools.fetch_tweets(query, max_items)
    except ApifyClientError as exc:
        raise RuntimeError(f"apify upstream error: {exc}") from exc


@mcp.tool(
    description=(
        "Fetch Reddit posts for a search query via Apify. "
        "Paywalled: $0.50 USDC on Base Sepolia per call."
    ),
    meta=_INTELLIGENCE_META_STANDARD,
)
async def fetch_reddit(query: str, max_items: int = 20) -> dict[str, Any]:
    try:
        return await apify_tools.fetch_reddit(query, max_items)
    except ApifyClientError as exc:
        raise RuntimeError(f"apify upstream error: {exc}") from exc


@mcp.tool(
    description=(
        "Fetch Google News articles for a search query via Apify. "
        "Paywalled: $0.50 USDC on Base Sepolia per call."
    ),
    meta=_INTELLIGENCE_META_STANDARD,
)
async def fetch_news(
    query: str, max_items: int = 20, language: str = "en"
) -> dict[str, Any]:
    try:
        return await apify_tools.fetch_news(query, max_items, language)
    except ApifyClientError as exc:
        raise RuntimeError(f"apify upstream error: {exc}") from exc


@mcp.tool(
    description=(
        "Aggregate tweets + news for a market topic and return raw sources. "
        "Paywalled: $0.50 USDC on Base Sepolia per call."
    ),
    meta=_INTELLIGENCE_META_STANDARD,
)
async def analyze_market(
    market_title: str, category: str = "general", max_items: int = 15
) -> dict[str, Any]:
    try:
        return await apify_tools.analyze_market(market_title, category, max_items)
    except ApifyClientError as exc:
        raise RuntimeError(f"apify upstream error: {exc}") from exc


@mcp.tool(
    description=(
        "Return tweet count and top tweet for each supplied market title. "
        "Paywalled: $0.75 USDC on Base Sepolia per call."
    ),
    meta=_INTELLIGENCE_META_PREMIUM,
)
async def markets_with_buzz(
    market_titles: list[str], max_tweets_per_market: int = 10
) -> list[dict[str, Any]]:
    try:
        return await apify_tools.markets_with_buzz(market_titles, max_tweets_per_market)
    except ApifyClientError as exc:
        raise RuntimeError(f"apify upstream error: {exc}") from exc
