"""Calldata builders — return TxCard / OrderCard without signing.

All functions are synchronous; call from routes via asyncio.to_thread.

AI consent rule (docs/constitution.md §5):
  We return encoded calldata.  The agent signs and broadcasts.
  We never see a private key.
"""

from __future__ import annotations

import secrets
from typing import Any, cast

from web3 import Web3

from api.lib.web3_client import Web3Client
from api.llm.tools.chain import get_wrapper_address, index_set_for_slot
from api.llm.tools.orderbook import find_best_asks

# ---------------------------------------------------------------------------
# Shared output models (plain dicts — Pydantic wrapping happens in routes)
# ---------------------------------------------------------------------------


def _tx(
    to: str,
    data: str,
    summary: str,
    value: str = "0",
) -> dict[str, Any]:
    return {"to": to.lower(), "data": data, "value": value, "summary": summary}


def _tx_card(
    to: str,
    data: str,
    chain_id: int,
    summary: str,
    requires: list[dict[str, Any]] | None = None,
    value: str = "0",
) -> dict[str, Any]:
    return {
        "to": to.lower(),
        "data": data,
        "value": value,
        "chain_id": chain_id,
        "summary": summary,
        "requires": requires or [],
    }


# ---------------------------------------------------------------------------
# ERC-20 approve helper
# ---------------------------------------------------------------------------


def _approve_calldata(
    client: Web3Client, token_address: str, spender: str, amount: int
) -> str:
    token = client.position_wrapper(token_address)
    checksum = Web3.to_checksum_address(spender)
    return cast(str, token.encode_abi("approve", args=[checksum, amount]))


def _tab_approve_tx(
    client: Web3Client, spender: str, amount: int, summary: str
) -> dict[str, Any]:
    data: str = client.tab.encode_abi(
        "approve", args=[Web3.to_checksum_address(spender), amount]
    )
    return _tx(to=client.tab.address, data=data, summary=summary)


# ---------------------------------------------------------------------------
# prepare_buy
# ---------------------------------------------------------------------------


def prepare_buy(
    client: Web3Client,
    market_id: int,
    condition_id: str,
    slot: int,
    amount_tab: int,
    orders: list[Any],  # list[Order] passed in from DB — avoid circular import
    chain_id: int,
    outcome_labels: list[str],
) -> dict[str, Any]:
    """Build calldata for buying `slot` outcome tokens for `amount_tab` TAB.

    Tries CLOB first; falls back to PMv2.splitAndWrap if insufficient liquidity.
    """
    index_set = index_set_for_slot(slot)
    label = outcome_labels[slot] if slot < len(outcome_labels) else str(slot)
    tab_addr = client.tab.address.lower()

    wrapper_addr = get_wrapper_address(client, condition_id, index_set)

    # ---- Try CLOB fill ----
    if wrapper_addr:
        fills = find_best_asks(
            orders=orders,
            tab_address=tab_addr,
            wrapper_address=wrapper_addr,
            amount_tab=amount_tab,
        )
        if fills:
            # Build fill calldata (first fill only; multi-fill = multi-tx)
            order_obj, fill_maker_amount = fills[0]

            # Reconstruct the on-chain Order struct tuple
            order_tuple = (
                Web3.to_checksum_address(order_obj.maker),
                Web3.to_checksum_address(order_obj.taker),
                Web3.to_checksum_address(order_obj.maker_token),
                Web3.to_checksum_address(order_obj.taker_token),
                int(order_obj.maker_amount),
                int(order_obj.taker_amount),
                order_obj.expiry,
                int(order_obj.salt),
                order_obj.market_id or market_id,
            )
            sig_bytes = bytes.fromhex(order_obj.signature.removeprefix("0x"))
            fill_data: str = client.tab_clob.encode_abi(
                "fill",
                args=[order_tuple, fill_maker_amount, sig_bytes],
            )

            # TAB cost for this fill (ceiling)
            ma = int(order_obj.maker_amount)
            ta = int(order_obj.taker_amount)
            tab_cost = (fill_maker_amount * ta + ma - 1) // ma
            price_per_token = ta / ma if ma else 0
            human_amount = fill_maker_amount / 10**18
            human_tab = tab_cost / 10**18

            requires = [
                _tab_approve_tx(
                    client,
                    spender=client.tab_clob.address,
                    amount=tab_cost,
                    summary=f"Approve TabClob to spend {human_tab:.4f} TAB",
                )
            ]
            return _tx_card(
                to=client.tab_clob.address,
                data=fill_data,
                chain_id=chain_id,
                summary=(
                    f"Buy {human_amount:.4f} {label} tokens at "
                    f"{price_per_token:.4f} TAB each in market #{market_id}"
                ),
                requires=requires,
            )

    # ---- Fallback: splitAndWrap ----
    # wrapIndexSets = [index_set] — wrap only the requested outcome
    split_data: str = client.pmv2.encode_abi(
        "splitAndWrap",
        args=[market_id, amount_tab, [index_set]],
    )
    human_tab = amount_tab / 10**18
    requires = [
        _tab_approve_tx(
            client,
            spender=client.pmv2.address,
            amount=amount_tab,
            summary=f"Approve PredictionMarket to spend {human_tab:.4f} TAB",
        )
    ]
    notice = (
        "No liquidity found on the order book — minting positions from collateral. "
        f"You will receive {human_tab:.4f} wrapped {label} tokens "
        "plus the complementary position(s) as ERC-1155."
    )
    return _tx_card(
        to=client.pmv2.address,
        data=split_data,
        chain_id=chain_id,
        summary=(
            f"Mint {human_tab:.4f} {label} position in market "
            f"#{market_id} (no CLOB liquidity — splitAndWrap)"
        ),
        requires=requires,
        value="0",
    ) | {"notice": notice}


# ---------------------------------------------------------------------------
# prepare_sell  → OrderCard (EIP-712 typed data, not a broadcast tx)
# ---------------------------------------------------------------------------


def prepare_sell(
    client: Web3Client,
    market_id: int,
    condition_id: str,
    slot: int,
    maker_amount: int,
    taker_amount: int,
    user_address: str,
    expiry: int,
    chain_id: int,
    outcome_labels: list[str],
) -> dict[str, Any]:
    """Build EIP-712 typed data for a limit sell order on TabClob.

    The agent signs `typed_data` with eth_signTypedData_v4 and POSTs the result
    to POST /v1/orders.  We never see a private key.
    """
    index_set = index_set_for_slot(slot)
    label = outcome_labels[slot] if slot < len(outcome_labels) else str(slot)

    wrapper_addr = get_wrapper_address(client, condition_id, index_set)
    if not wrapper_addr:
        raise ValueError(
            f"No PositionWrapper deployed for market #{market_id} slot {slot}. "
            "The market must have had at least one splitAndWrap call first."
        )

    salt = int.from_bytes(secrets.token_bytes(32), "big")

    order_message = {
        "maker": Web3.to_checksum_address(user_address),
        "taker": "0x0000000000000000000000000000000000000000",
        "makerToken": Web3.to_checksum_address(wrapper_addr),
        "takerToken": Web3.to_checksum_address(client.tab.address),
        "makerAmount": maker_amount,
        "takerAmount": taker_amount,
        "expiry": expiry,
        "salt": salt,
        "marketId": market_id,
    }

    typed_data: dict[str, Any] = {
        "domain": {
            "name": "TabClob",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": client.tab_clob.address,
        },
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Order": [
                {"name": "maker", "type": "address"},
                {"name": "taker", "type": "address"},
                {"name": "makerToken", "type": "address"},
                {"name": "takerToken", "type": "address"},
                {"name": "makerAmount", "type": "uint128"},
                {"name": "takerAmount", "type": "uint128"},
                {"name": "expiry", "type": "uint64"},
                {"name": "salt", "type": "uint256"},
                {"name": "marketId", "type": "uint256"},
            ],
        },
        "primaryType": "Order",
        "message": order_message,
    }

    # Approval: maker must approve TabClob to transfer their wPosition tokens
    wrapper_contract = client.position_wrapper(wrapper_addr)
    approval_data: str = wrapper_contract.encode_abi(
        "approve",
        args=[Web3.to_checksum_address(client.tab_clob.address), maker_amount],
    )

    human_maker = maker_amount / 10**18
    price = taker_amount / maker_amount if maker_amount else 0

    return {
        "typed_data": typed_data,
        "approval": _tx(
            to=wrapper_addr,
            data=approval_data,
            summary=f"Approve TabClob to transfer {human_maker:.4f} {label} tokens",
        ),
        "chain_id": chain_id,
        "summary": (
            f"Sell {human_maker:.4f} {label} at "
            f"{price:.4f} TAB each in market #{market_id}"
        ),
        "order_template": {
            "maker": order_message["maker"],
            "taker": order_message["taker"],
            "makerToken": order_message["makerToken"],
            "takerToken": order_message["takerToken"],
            "makerAmount": str(maker_amount),
            "takerAmount": str(taker_amount),
            "expiry": expiry,
            "salt": str(salt),
            "chainId": chain_id,
            "verifyingContract": client.tab_clob.address,
        },
    }


# ---------------------------------------------------------------------------
# prepare_create_market
# ---------------------------------------------------------------------------


def prepare_create_market(
    client: Web3Client,
    name: str,
    description: str,
    category: str,
    outcome_type: int,  # 0=BINARY, 1=MULTI, 2=SCALAR
    outcome_slot_count: int,
    outcome_labels: list[str],
    oracle: str,
    expires_at: int,
    resolution_time: int,
    chain_id: int,
) -> dict[str, Any]:
    """Build createMarket calldata. Requires prior TAB.approve(PMv2, defaultBond)."""
    default_bond: int = client.pmv2.functions.defaultBond().call()

    params_tuple = (
        name,
        description,
        category,
        outcome_type,
        outcome_slot_count,
        outcome_labels,
        Web3.to_checksum_address(oracle),
        expires_at,
        resolution_time,
    )
    create_data: str = client.pmv2.encode_abi("createMarket", args=[params_tuple])

    human_bond = default_bond / 10**18
    requires = [
        _tab_approve_tx(
            client,
            spender=client.pmv2.address,
            amount=default_bond,
            summary=f"Approve PredictionMarket to collect {human_bond:.4f} TAB bond",
        )
    ]
    return _tx_card(
        to=client.pmv2.address,
        data=create_data,
        chain_id=chain_id,
        summary=f"Create market: {name!r}",
        requires=requires,
    )


# ---------------------------------------------------------------------------
# prepare_claim
# ---------------------------------------------------------------------------


def prepare_claim(
    client: Web3Client,
    market_id: int,
    index_sets: list[int],
    chain_id: int,
) -> dict[str, Any]:
    """Build claimWinnings calldata. Requires ct.setApprovalForAll(PMv2, true)."""
    claim_data: str = client.pmv2.encode_abi(
        "claimWinnings", args=[market_id, index_sets]
    )
    set_approval_data: str = client.ct.encode_abi(
        "setApprovalForAll",
        args=[Web3.to_checksum_address(client.pmv2.address), True],
    )
    requires = [
        _tx(
            to=client.ct.address,
            data=set_approval_data,
            summary="Approve PredictionMarket to transfer your winning positions",
        )
    ]
    return _tx_card(
        to=client.pmv2.address,
        data=claim_data,
        chain_id=chain_id,
        summary=f"Claim winnings from market #{market_id}",
        requires=requires,
    )


# ---------------------------------------------------------------------------
# prepare_merge
# ---------------------------------------------------------------------------


def prepare_merge(
    client: Web3Client,
    market_id: int,
    partition: list[int],
    amount: int,
    chain_id: int,
) -> dict[str, Any]:
    """Build mergeFrom calldata (recover TAB by burning a full position set)."""
    merge_data: str = client.pmv2.encode_abi(
        "mergeFrom", args=[market_id, partition, amount]
    )
    set_approval_data: str = client.ct.encode_abi(
        "setApprovalForAll",
        args=[Web3.to_checksum_address(client.pmv2.address), True],
    )
    human_amount = amount / 10**18
    requires = [
        _tx(
            to=client.ct.address,
            data=set_approval_data,
            summary="Approve PredictionMarket to burn your position tokens",
        )
    ]
    return _tx_card(
        to=client.pmv2.address,
        data=merge_data,
        chain_id=chain_id,
        summary=(
            f"Recover {human_amount:.4f} TAB by merging positions "
            f"in market #{market_id}"
        ),
        requires=requires,
    )


# ---------------------------------------------------------------------------
# prepare_resolve_market
# ---------------------------------------------------------------------------


def prepare_resolve_market(
    client: Web3Client,
    market_id: int,
    payouts: list[int],
    chain_id: int,
) -> dict[str, Any]:
    """Build resolveMarket calldata. Callable by oracle or creator."""
    resolve_data: str = client.pmv2.encode_abi(
        "resolveMarket", args=[market_id, payouts]
    )
    return _tx_card(
        to=client.pmv2.address,
        data=resolve_data,
        chain_id=chain_id,
        summary=f"Resolve market #{market_id} with payouts {payouts}",
    )


# ---------------------------------------------------------------------------
# prepare_cancel_order
# ---------------------------------------------------------------------------


def prepare_cancel_order(
    client: Web3Client,
    order: Any,  # db Order model
    chain_id: int,
) -> dict[str, Any]:
    """Build TabClob.cancel calldata for an existing maker order."""
    order_tuple = (
        Web3.to_checksum_address(order.maker),
        Web3.to_checksum_address(order.taker),
        Web3.to_checksum_address(order.maker_token),
        Web3.to_checksum_address(order.taker_token),
        int(order.maker_amount),
        int(order.taker_amount),
        order.expiry,
        int(order.salt),
        order.market_id or 0,
    )
    cancel_data: str = client.tab_clob.encode_abi("cancel", args=[order_tuple])
    return _tx_card(
        to=client.tab_clob.address,
        data=cancel_data,
        chain_id=chain_id,
        summary=f"Cancel order {order.id}",
    )
