"""On-chain `tx_hash` verification.

Resolves an RPC URL per `chain_id` and asserts the receipt is confirmed and
successful. Tests override `get_tx_verifier` via `app.dependency_overrides`,
so production paths never need a live RPC and tests never need web3 mocks
beyond a stub callable.
"""

from __future__ import annotations

import asyncio
import os
from typing import Protocol

from web3 import Web3

ALLOWED_CHAINS: frozenset[int] = frozenset({31337, 84532})

_DEFAULT_RPC_URLS: dict[int, str] = {
    31337: "http://127.0.0.1:8545",
    84532: "https://sepolia.base.org",
}


class TxVerificationError(Exception):
    """Raised when a tx_hash cannot be verified as confirmed and successful."""


class TxVerifier(Protocol):
    async def __call__(self, chain_id: int, tx_hash: str) -> None: ...


def _rpc_url(chain_id: int) -> str:
    env_key = f"RPC_URL_{chain_id}"
    return os.getenv(env_key) or _DEFAULT_RPC_URLS[chain_id]


def _verify_sync(chain_id: int, tx_hash: str) -> None:
    w3 = Web3(Web3.HTTPProvider(_rpc_url(chain_id)))
    receipt = w3.eth.get_transaction_receipt(tx_hash)  # type: ignore[arg-type]
    if receipt is None:
        raise TxVerificationError("transaction not found")
    if receipt.get("blockNumber") is None:
        raise TxVerificationError("transaction not confirmed")
    if receipt.get("status") != 1:
        raise TxVerificationError("transaction reverted")


async def verify_tx(chain_id: int, tx_hash: str) -> None:
    """Default verifier: web3.py `eth_getTransactionReceipt` in a thread."""
    if chain_id not in ALLOWED_CHAINS:
        raise TxVerificationError(f"chain_id {chain_id} not in allow-list")
    await asyncio.to_thread(_verify_sync, chain_id, tx_hash)


def get_tx_verifier() -> TxVerifier:
    """FastAPI dependency factory. Tests override the function this returns."""
    return verify_tx
