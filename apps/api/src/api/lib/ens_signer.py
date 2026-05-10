"""CCIP-Read gateway response signer (Track 2, §4.2 of ENS spec).

Signs gateway responses so the on-chain MarketResolver can verify them
in its resolveWithProof callback.

Digest format (EIP-191 version 0x00):
  keccak256(0x1900 ‖ resolverAddress ‖ expires ‖ keccak256(request) ‖ keccak256(result))

Env vars:
  ENS_GATEWAY_SIGNER_PK       — private key (hex, with or without 0x prefix)
  ENS_RESOLVER_ADDRESS         — on-chain MarketResolver address on Sepolia
"""

from __future__ import annotations

import os
import time

from eth_account import Account
from eth_utils import keccak

_SIGNER_PK = os.getenv("ENS_GATEWAY_SIGNER_PK", "")
_RESOLVER_ADDR = os.getenv("ENS_RESOLVER_ADDRESS", "")
_DEFAULT_TTL = int(os.getenv("ENS_GATEWAY_TTL_SECONDS", "300"))


def is_signer_configured() -> bool:
    return bool(_SIGNER_PK and _RESOLVER_ADDR)


def get_signer_address() -> str:
    if not _SIGNER_PK:
        raise RuntimeError("ENS_GATEWAY_SIGNER_PK is not set")
    acct = Account.from_key(_SIGNER_PK)
    return acct.address


def sign_gateway_response(
    result: bytes,
    request: bytes,
    ttl: int | None = None,
) -> tuple[bytes, int, bytes]:
    """Sign a CCIP-Read gateway response.

    Returns (result, expires, signature) ready for ABI encoding.
    """
    if not _SIGNER_PK:
        raise RuntimeError("ENS_GATEWAY_SIGNER_PK is not set")
    if not _RESOLVER_ADDR:
        raise RuntimeError("ENS_RESOLVER_ADDRESS is not set")

    expires = int(time.time()) + (ttl or _DEFAULT_TTL)

    resolver_bytes = bytes.fromhex(_RESOLVER_ADDR.removeprefix("0x"))

    digest = keccak(
        b"\x19\x00"
        + _left_pad_address(resolver_bytes)
        + expires.to_bytes(8, "big")
        + keccak(request)
        + keccak(result)
    )

    acct = Account.from_key(_SIGNER_PK)
    signed = acct.signHash(digest)

    return result, expires, bytes(signed.signature)


def _left_pad_address(addr_bytes: bytes) -> bytes:
    """Ensure address is exactly 20 bytes (no padding — raw address)."""
    if len(addr_bytes) > 20:
        addr_bytes = addr_bytes[-20:]
    return addr_bytes
