"""On-chain read helpers shared by routes/markets.py.

All functions are synchronous (web3.py is sync); callers wrap in
`asyncio.to_thread` where needed.
"""

from __future__ import annotations

from web3 import Web3

from api.lib.web3_client import Web3Client


def get_tab_balance(client: Web3Client, address: str) -> dict[str, str]:
    """Return raw and human-readable TAB balance for `address`."""
    checksum = Web3.to_checksum_address(address)
    raw: int = client.tab.functions.balanceOf(checksum).call()
    # TABcoin has 18 decimals — format to 6 decimal places for display
    human = f"{raw / 10**18:.6f}"
    return {"balance": str(raw), "formatted": human}


def index_set_for_slot(slot: int) -> int:
    """Convert outcome slot index to ConditionalTokens indexSet bitmask."""
    return 1 << slot


def get_wrapper_address(
    client: Web3Client,
    condition_id: str,
    index_set: int,
) -> str | None:
    """Return PositionWrapper ERC-20 address for the given condition+indexSet.

    Returns None if the wrapper has not been deployed yet.
    """
    tab_addr = client.tab.address
    result: str = client.wrapper_factory.functions.getWrapper(
        tab_addr,
        bytes.fromhex(condition_id.removeprefix("0x")),
        index_set,
    ).call()
    # factory returns address(0) when wrapper doesn't exist
    if result == "0x" + "0" * 40:
        return None
    return result.lower()


def get_user_positions(
    client: Web3Client,
    condition_id: str,
    outcome_slot_count: int,
    user_address: str,
    outcome_labels: list[str],
) -> list[dict[str, object]]:
    """Return ERC-1155 and ERC-20 position balances for each outcome slot."""
    checksum_user = Web3.to_checksum_address(user_address)
    tab_addr = client.tab.address
    condition_id_bytes = bytes.fromhex(condition_id.removeprefix("0x"))

    positions = []
    for slot in range(outcome_slot_count):
        index_set = index_set_for_slot(slot)
        label = outcome_labels[slot] if slot < len(outcome_labels) else str(slot)

        # ERC-1155 position ID
        collection_id: bytes = client.ct.functions.getCollectionId(
            condition_id_bytes, index_set
        ).call()
        position_id: int = client.ct.functions.getPositionId(
            tab_addr, collection_id
        ).call()
        balance_1155: int = client.ct.functions.balanceOf(
            checksum_user, position_id
        ).call()

        # ERC-20 wrapped balance (may be 0 if no wrapper deployed)
        wrapper_addr = get_wrapper_address(client, condition_id, index_set)
        balance_wrapped = 0
        if wrapper_addr:
            wrapper = client.position_wrapper(wrapper_addr)
            balance_wrapped = wrapper.functions.balanceOf(checksum_user).call()

        positions.append(
            {
                "slot": slot,
                "label": label,
                "index_set": index_set,
                "position_id": str(position_id),
                "wrapper_address": wrapper_addr,
                "balance_1155": str(balance_1155),
                "balance_wrapped": str(balance_wrapped),
            }
        )

    return positions
