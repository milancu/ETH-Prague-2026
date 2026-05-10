"""Tool registry — bridges Gemini function calling to existing tool functions.

Each tool is registered with a Gemini-compatible function declaration and
a callable that takes parsed arguments + a ToolContext.  prepare_* tools
push TxCards into the context accumulator.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any

from google.genai import types
from sqlalchemy.ext.asyncio import AsyncSession

from api.lib.web3_client import Web3Client
from api.llm.tools import apify as apify_tools
from api.llm.tools import chain as chain_tools
from api.llm.tools import dice as dice_tools
from api.llm.tools import markets as market_tools
from api.llm.tools import prepare as prepare_tools
from api.llm.tools.markets import get_market_model, get_orders_for_market

_DEFAULT_CHAIN_ID = int(os.getenv("CHAIN_ID", "31337"))


@dataclass
class ToolContext:
    """Mutable context threaded through every tool call in one chat turn."""

    session: AsyncSession
    client: Web3Client
    chain_id: int
    user_address: str | None = None
    tx_cards: list[dict[str, Any]] = field(default_factory=list)


ToolCallable = Any  # async (args: dict, ctx: ToolContext) -> dict | list | str


@dataclass
class RegisteredTool:
    declaration: types.FunctionDeclaration
    fn: ToolCallable


def _require_address(ctx: ToolContext) -> str:
    if not ctx.user_address:
        raise ValueError("user_address is required for this operation")
    return ctx.user_address


# ---------------------------------------------------------------------------
# Tool implementations — thin wrappers that delegate to existing modules
# ---------------------------------------------------------------------------


async def _get_tab_balance(args: dict[str, Any], ctx: ToolContext) -> dict[str, str]:
    address = args.get("address") or _require_address(ctx)
    return await asyncio.to_thread(chain_tools.get_tab_balance, ctx.client, address)


async def _get_user_positions(
    args: dict[str, Any], ctx: ToolContext
) -> list[dict[str, object]]:
    market_id = int(args["market_id"])
    address = args.get("address") or _require_address(ctx)
    market = await get_market_model(ctx.session, market_id)
    if market is None:
        return [{"error": f"Market #{market_id} not found"}]
    labels = [o.get("label", str(i)) for i, o in enumerate(market.outcomes)]
    return await asyncio.to_thread(
        chain_tools.get_user_positions,
        ctx.client,
        market.condition_id,
        len(market.outcomes),
        address,
        labels,
    )


async def _list_markets(
    args: dict[str, Any], ctx: ToolContext
) -> list[dict[str, object]]:
    return await market_tools.list_markets(
        ctx.session,
        category=args.get("category"),
        status=args.get("status"),
        limit=int(args.get("limit", 20)),
    )


async def _get_market(args: dict[str, Any], ctx: ToolContext) -> dict[str, object]:
    result = await market_tools.get_market(ctx.session, int(args["market_id"]))
    if result is None:
        return {"error": f"Market #{args['market_id']} not found"}
    return result


async def _search_markets(
    args: dict[str, Any], ctx: ToolContext
) -> list[dict[str, object]]:
    return await market_tools.search_markets(
        ctx.session, args["query"], limit=int(args.get("limit", 10))
    )


async def _get_market_status(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, object]:
    result = await market_tools.get_market_status(ctx.session, int(args["market_id"]))
    if result is None:
        return {"error": f"Market #{args['market_id']} not found"}
    return result


async def _list_orders(
    args: dict[str, Any], ctx: ToolContext
) -> list[dict[str, object]]:
    return await market_tools.list_orders(
        ctx.session,
        market_id=int(args["market_id"]) if args.get("market_id") else None,
        maker=args.get("maker"),
    )


async def _prepare_buy(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    market_id = int(args["market_id"])
    slot = int(args["slot"])
    amount_tab = int(args["amount_tab"])
    market = await get_market_model(ctx.session, market_id)
    if market is None:
        return {"error": f"Market #{market_id} not found"}
    orders = await get_orders_for_market(ctx.session, market_id)
    labels = [o.get("label", str(i)) for i, o in enumerate(market.outcomes)]
    card = await asyncio.to_thread(
        prepare_tools.prepare_buy,
        ctx.client,
        market_id,
        market.condition_id,
        slot,
        amount_tab,
        orders,
        ctx.chain_id,
        labels,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _prepare_sell(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    market_id = int(args["market_id"])
    slot = int(args["slot"])
    maker_amount = int(args["maker_amount"])
    taker_amount = int(args["taker_amount"])
    expiry = int(args["expiry"])
    address = _require_address(ctx)
    market = await get_market_model(ctx.session, market_id)
    if market is None:
        return {"error": f"Market #{market_id} not found"}
    labels = [o.get("label", str(i)) for i, o in enumerate(market.outcomes)]
    card = await asyncio.to_thread(
        prepare_tools.prepare_sell,
        ctx.client,
        market_id,
        market.condition_id,
        slot,
        maker_amount,
        taker_amount,
        address,
        expiry,
        ctx.chain_id,
        labels,
    )
    ctx.tx_cards.append(card)
    return {"status": "order_card_created", "summary": card.get("summary", "")}


async def _prepare_create_market(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    oracle = args.get("oracle") or _require_address(ctx)

    # Derive shape from labels when the LLM omits outcome_type / slot_count, so
    # we can't ship a card that reverts in PMv2._validateOutcomeShape (BINARY/
    # SCALAR require 2 slots, MULTI requires ≥3) or trips the labels-length
    # check. Hardhat surfaces both as an opaque "internal error" via eth_call.
    labels: list[str] = args.get("outcome_labels", ["No", "Yes"])
    slot_count = int(args.get("outcome_slot_count", len(labels)))
    if "outcome_type" in args:
        outcome_type = int(args["outcome_type"])
    else:
        outcome_type = 0 if slot_count == 2 else 1  # BINARY / MULTI

    card = await asyncio.to_thread(
        prepare_tools.prepare_create_market,
        ctx.client,
        args["name"],
        args["description"],
        args.get("category", "other"),
        outcome_type,
        slot_count,
        labels,
        oracle,
        int(args["expires_at"]),
        int(args["resolution_time"]),
        ctx.chain_id,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _prepare_merge(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    card = await asyncio.to_thread(
        prepare_tools.prepare_merge,
        ctx.client,
        int(args["market_id"]),
        [int(x) for x in args["partition"]],
        int(args["amount"]),
        ctx.chain_id,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _prepare_claim(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    card = await asyncio.to_thread(
        prepare_tools.prepare_claim,
        ctx.client,
        int(args["market_id"]),
        [int(x) for x in args["index_sets"]],
        ctx.chain_id,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _prepare_cancel_order(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    from api.db.models import Order

    order = await ctx.session.get(Order, args["order_id"])
    if order is None:
        return {"error": f"Order {args['order_id']} not found"}
    card = await asyncio.to_thread(
        prepare_tools.prepare_cancel_order,
        ctx.client,
        order,
        ctx.chain_id,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _fetch_tweets(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    return await apify_tools.fetch_tweets(
        args["query"], max_items=int(args.get("max_items", 20))
    )


async def _fetch_reddit(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    return await apify_tools.fetch_reddit(
        args["query"], max_items=int(args.get("max_items", 20))
    )


async def _fetch_news(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    return await apify_tools.fetch_news(
        args["query"], max_items=int(args.get("max_items", 20))
    )


async def _analyze_market(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    return await apify_tools.analyze_market(
        args["market_title"],
        category=args.get("category", "general"),
        max_items=int(args.get("max_items", 15)),
    )


async def _prepare_resolve_market(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    card = await asyncio.to_thread(
        prepare_tools.prepare_resolve_market,
        ctx.client,
        int(args["market_id"]),
        [int(p) for p in args["payouts"]],
        ctx.chain_id,
    )
    ctx.tx_cards.append(card)
    return {"status": "tx_card_created", "summary": card.get("summary", "")}


async def _prepare_create_dice_market(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    address = _require_address(ctx)
    result = await dice_tools.prepare_create_dice_market(
        ctx.session,
        ctx.client,
        args["name"],
        args.get("description", ""),
        float(args.get("delay_minutes", 5)),
        address,
        ctx.chain_id,
    )
    if "tx_card" in result:
        ctx.tx_cards.append(result["tx_card"])
    return result


async def _link_dice_market(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    return await dice_tools.link_dice_market(
        ctx.session,
        int(args["commitment_id"]),
        int(args["market_id"]),
    )


async def _reveal_dice_market(
    args: dict[str, Any], ctx: ToolContext
) -> dict[str, Any]:
    result = await dice_tools.reveal_dice_market(
        ctx.session,
        ctx.client,
        int(args["commitment_id"]),
        ctx.chain_id,
    )
    if "tx_card" in result:
        ctx.tx_cards.append(result["tx_card"])
    return result


# ---------------------------------------------------------------------------
# Gemini function declarations
# ---------------------------------------------------------------------------


def _decl(
    name: str,
    description: str,
    parameters: dict[str, Any],
    required: list[str] | None = None,
) -> types.FunctionDeclaration:
    schema = {"type": "object", "properties": parameters}
    if required:
        schema["required"] = required
    return types.FunctionDeclaration(
        name=name,
        description=description,
        parameters=schema,
    )


_TOOL_DEFS: list[tuple[types.FunctionDeclaration, ToolCallable]] = [
    # -- chain reads --
    (
        _decl(
            "get_tab_balance",
            "Get TAB token balance for an address.",
            {"address": {"type": "string", "description": "Wallet address (0x...)"}},
        ),
        _get_tab_balance,
    ),
    (
        _decl(
            "get_user_positions",
            "Get position balances for a user in a specific market.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "address": {"type": "string", "description": "User wallet address"},
            },
            required=["market_id"],
        ),
        _get_user_positions,
    ),
    # -- market queries --
    (
        _decl(
            "list_markets",
            "List prediction markets. Filter by category or status.",
            {
                "category": {"type": "string", "description": "Filter by category"},
                "status": {
                    "type": "string",
                    "description": "Filter: pending, open, resolved, cancelled",
                },
                "limit": {"type": "integer", "description": "Max results (default 20)"},
            },
        ),
        _list_markets,
    ),
    (
        _decl(
            "get_market",
            "Get full details for a market by its on-chain ID.",
            {"market_id": {"type": "integer", "description": "On-chain market ID"}},
            required=["market_id"],
        ),
        _get_market,
    ),
    (
        _decl(
            "search_markets",
            "Search markets by title keyword.",
            {
                "query": {"type": "string", "description": "Search text"},
                "limit": {"type": "integer", "description": "Max results (default 10)"},
            },
            required=["query"],
        ),
        _search_markets,
    ),
    (
        _decl(
            "get_market_status",
            "Get current status and resolution info for a market.",
            {"market_id": {"type": "integer", "description": "On-chain market ID"}},
            required=["market_id"],
        ),
        _get_market_status,
    ),
    (
        _decl(
            "list_orders",
            "List CLOB orders, optionally filtered by market or maker address.",
            {
                "market_id": {"type": "integer", "description": "Filter by market ID"},
                "maker": {"type": "string", "description": "Filter by maker address"},
            },
        ),
        _list_orders,
    ),
    # -- prepare (tx-producing) --
    (
        _decl(
            "prepare_buy",
            "Build calldata to buy outcome tokens. Returns a TxCard.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "slot": {
                    "type": "integer",
                    "description": "Outcome slot (0=No, 1=Yes for binary)",
                },
                "amount_tab": {
                    "type": "string",
                    "description": "TAB to spend in wei",
                },
            },
            required=["market_id", "slot", "amount_tab"],
        ),
        _prepare_buy,
    ),
    (
        _decl(
            "prepare_sell",
            "Build an EIP-712 limit sell order. Returns an OrderCard.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "slot": {"type": "integer", "description": "Outcome slot index"},
                "maker_amount": {
                    "type": "string",
                    "description": "Position tokens to sell, in wei",
                },
                "taker_amount": {
                    "type": "string",
                    "description": "TAB to receive, in wei",
                },
                "expiry": {
                    "type": "integer",
                    "description": "Unix timestamp when order expires",
                },
            },
            required=["market_id", "slot", "maker_amount", "taker_amount", "expiry"],
        ),
        _prepare_sell,
    ),
    (
        _decl(
            "prepare_create_market",
            "Build calldata to create a new prediction market.",
            {
                "name": {"type": "string", "description": "Market title / question"},
                "description": {
                    "type": "string",
                    "description": "Full description and resolution criteria",
                },
                "category": {
                    "type": "string",
                    "description": "Category (e.g. politics, sports)",
                },
                "outcome_type": {
                    "type": "integer",
                    "description": "0=binary, 1=multi, 2=scalar",
                },
                "outcome_slot_count": {
                    "type": "integer",
                    "description": "Number of outcome slots",
                },
                "outcome_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Labels for each outcome slot",
                },
                "oracle": {
                    "type": "string",
                    "description": "Oracle address (defaults to user address)",
                },
                "expires_at": {
                    "type": "integer",
                    "description": "Unix timestamp when market expires",
                },
                "resolution_time": {
                    "type": "integer",
                    "description": "Unix timestamp for resolution",
                },
            },
            required=["name", "description", "expires_at", "resolution_time"],
        ),
        _prepare_create_market,
    ),
    (
        _decl(
            "prepare_merge",
            "Build calldata to merge a full set of positions back into TAB.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "partition": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Index sets forming a full partition",
                },
                "amount": {
                    "type": "string",
                    "description": "Amount to merge, in wei",
                },
            },
            required=["market_id", "partition", "amount"],
        ),
        _prepare_merge,
    ),
    (
        _decl(
            "prepare_claim",
            "Build calldata to claim winnings from a resolved market.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "index_sets": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Index sets of winning positions to redeem",
                },
            },
            required=["market_id", "index_sets"],
        ),
        _prepare_claim,
    ),
    (
        _decl(
            "prepare_cancel_order",
            "Build calldata to cancel an existing CLOB order.",
            {
                "order_id": {
                    "type": "string",
                    "description": "Order ID to cancel",
                },
            },
            required=["order_id"],
        ),
        _prepare_cancel_order,
    ),
    # -- resolve --
    (
        _decl(
            "prepare_resolve_market",
            "Build resolveMarket calldata. Only callable by oracle or creator.",
            {
                "market_id": {"type": "integer", "description": "On-chain market ID"},
                "payouts": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Payout vector (one entry per outcome slot)",
                },
            },
            required=["market_id", "payouts"],
        ),
        _prepare_resolve_market,
    ),
    # -- dice (SpaceComputer cTRNG) --
    (
        _decl(
            "prepare_create_dice_market",
            (
                "Create a cosmic dice market powered by SpaceComputer cTRNG. "
                "Returns a TxCard for createMarket + a commitment for later reveal."
            ),
            {
                "name": {"type": "string", "description": "Market title"},
                "description": {"type": "string", "description": "Market description"},
                "delay_minutes": {
                    "type": "number",
                    "description": "Minutes until the dice roll (default 5)",
                },
            },
            required=["name"],
        ),
        _prepare_create_dice_market,
    ),
    (
        _decl(
            "link_dice_market",
            (
                "Link an on-chain market_id to a dice commitment after "
                "the user signs the createMarket transaction."
            ),
            {
                "commitment_id": {
                    "type": "integer",
                    "description": (
                        "DiceCommitment DB ID from "
                        "prepare_create_dice_market"
                    ),
                },
                "market_id": {
                    "type": "integer",
                    "description": "On-chain market ID from the confirmed tx",
                },
            },
            required=["commitment_id", "market_id"],
        ),
        _link_dice_market,
    ),
    (
        _decl(
            "reveal_dice_market",
            (
                "Reveal a cosmic dice result and build resolveMarket calldata. "
                "Fetches the committed beacon block and derives "
                "the die roll."
            ),
            {
                "commitment_id": {
                    "type": "integer",
                    "description": "DiceCommitment DB ID",
                },
            },
            required=["commitment_id"],
        ),
        _reveal_dice_market,
    ),
    # -- intelligence (apify) --
    (
        _decl(
            "fetch_tweets",
            "Search Twitter/X for tweets about a topic.",
            {
                "query": {"type": "string", "description": "Search query"},
                "max_items": {"type": "integer", "description": "Max tweets"},
            },
            required=["query"],
        ),
        _fetch_tweets,
    ),
    (
        _decl(
            "fetch_reddit",
            "Search Reddit for posts about a topic.",
            {
                "query": {"type": "string", "description": "Search query"},
                "max_items": {"type": "integer", "description": "Max posts"},
            },
            required=["query"],
        ),
        _fetch_reddit,
    ),
    (
        _decl(
            "fetch_news",
            "Search Google News for articles about a topic.",
            {
                "query": {"type": "string", "description": "Search query"},
                "max_items": {
                    "type": "integer",
                    "description": "Max articles (default 20)",
                },
            },
            required=["query"],
        ),
        _fetch_news,
    ),
    (
        _decl(
            "analyze_market",
            "Aggregate tweets and news for a market topic. Returns raw sources.",
            {
                "market_title": {
                    "type": "string",
                    "description": "Market title to research",
                },
                "category": {"type": "string", "description": "Category hint"},
                "max_items": {
                    "type": "integer",
                    "description": "Max items per source",
                },
            },
            required=["market_title"],
        ),
        _analyze_market,
    ),
]


def get_tool_registry() -> list[RegisteredTool]:
    """Return the full list of registered tools."""
    return [RegisteredTool(declaration=decl, fn=fn) for decl, fn in _TOOL_DEFS]


def get_gemini_tools() -> list[types.Tool]:
    """Return Gemini Tool objects for all registered tools."""
    declarations = [decl for decl, _ in _TOOL_DEFS]
    return [types.Tool(function_declarations=declarations)]


def get_tool_map() -> dict[str, ToolCallable]:
    """Return name → callable mapping for dispatching function calls."""
    return {decl.name: fn for decl, fn in _TOOL_DEFS}
