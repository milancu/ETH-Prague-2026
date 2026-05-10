"""Singleton web3.py client with contract bindings.

Addresses come from env vars (per chain) so each developer can point at their
own Hardhat node.  Defaults shipped here are for the canonical local Hardhat
deploy; they must be overridden when pointing at Base Sepolia.

Env vars (replace {id} with chain id, e.g. 31337):
  RPC_URL_{id}                    HTTP RPC endpoint
  TAB_ADDRESS_{id}                TABcoin ERC-20
  CT_ADDRESS_{id}                 ConditionalTokens ERC-1155
  PMV2_ADDRESS_{id}               PredictionMarketV2
  WRAPPER_FACTORY_ADDRESS_{id}    PositionWrapperFactory
  TAB_CLOB_ADDRESS_{id}           TabClob
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from web3 import Web3
from web3.contract import Contract

# ---------------------------------------------------------------------------
# ABI loader
# ---------------------------------------------------------------------------

_ABI_DIR = Path(__file__).parent.parent / "abi"

_HARDHAT_ARTIFACTS = (
    Path(__file__).parent.parent.parent.parent.parent.parent
    / "apps/contracts/packages/hardhat/artifacts/contracts"
)


def _load_abi(name: str) -> list[dict[str, Any]]:
    local = _ABI_DIR / f"{name}.json"
    if local.exists():
        with open(local) as fh:
            return json.load(fh)  # type: ignore[no-any-return]
    hardhat = _HARDHAT_ARTIFACTS / f"{name}.sol" / f"{name}.json"
    with open(hardhat) as fh:
        return json.load(fh)["abi"]  # type: ignore[no-any-return]


_ABI: dict[str, list[dict[str, Any]]] = {}


def _abi(name: str) -> list[dict[str, Any]]:
    if name not in _ABI:
        _ABI[name] = _load_abi(name)
    return _ABI[name]


# ---------------------------------------------------------------------------
# Default addresses (local Hardhat — update on every fresh deploy)
# ---------------------------------------------------------------------------

_HARDHAT_DEFAULTS: dict[str, str] = {
    # Deterministic CREATE addresses from Hardhat default account #0 starting
    # at nonce 0. Match what `pnpm deploy` produces on a fresh non-forked node
    # (BASE_FORK unset in hardhat.config.ts).
    "tab": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "ct": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "pmv2": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "wrapper_factory": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    "tab_clob": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
}

_SEPOLIA_DEFAULTS: dict[str, str] = {
    "tab": "0xe987bdb99fE70af574D4d9eeA5A7700fe29feB16",
    "ct": "0x912c5a72B5a024Ff88987B19632D670185c5A65e",
    "pmv2": "0xE5ddc8f9Ed573CfA1c23aaF97D6193FD2510EF93",
    "wrapper_factory": "0x5F57977678EE0B53Ca91adeF98D9C6D315C5ab81",
    "tab_clob": "0xC34715695188b3cE1319C9BF7423713fB3C2A470",
}

_CHAIN_DEFAULTS: dict[int, dict[str, str]] = {
    31337: _HARDHAT_DEFAULTS,
    84532: _SEPOLIA_DEFAULTS,
}

_DEFAULT_RPC: dict[int, str] = {
    31337: "http://127.0.0.1:8545",
    84532: "https://sepolia.base.org",
}


def _address(key: str, chain_id: int) -> str:
    env_key = f"{key.upper()}_ADDRESS_{chain_id}"
    default = _CHAIN_DEFAULTS.get(chain_id, {}).get(key, "")
    return os.getenv(env_key, default)


def _rpc_url(chain_id: int) -> str:
    return os.getenv(f"RPC_URL_{chain_id}", _DEFAULT_RPC.get(chain_id, ""))


# ---------------------------------------------------------------------------
# Web3Client — one instance per chain_id, cached module-level
# ---------------------------------------------------------------------------


class Web3Client:
    """Lazily-connected web3 client with pre-bound contracts."""

    def __init__(self, chain_id: int) -> None:
        self.chain_id = chain_id
        self._w3 = Web3(Web3.HTTPProvider(_rpc_url(chain_id)))

        self.tab: Contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(_address("tab", chain_id)),
            abi=_abi("TABcoin"),
        )
        self.ct: Contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(_address("ct", chain_id)),
            abi=_abi("ConditionalTokens"),
        )
        self.pmv2: Contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(_address("pmv2", chain_id)),
            abi=_abi("PredictionMarketV2"),
        )
        self.wrapper_factory: Contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(_address("wrapper_factory", chain_id)),
            abi=_abi("PositionWrapperFactory"),
        )
        self.tab_clob: Contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(_address("tab_clob", chain_id)),
            abi=_abi("TabClob"),
        )

    # Convenience: wrapper ERC-20 at arbitrary address
    def position_wrapper(self, address: str) -> Contract:
        return self._w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=_abi("PositionWrapper"),
        )

    @property
    def w3(self) -> Web3:
        return self._w3


_clients: dict[int, Web3Client] = {}


def get_client(chain_id: int = 31337) -> Web3Client:
    """Return cached Web3Client for the given chain."""
    if chain_id not in _clients:
        _clients[chain_id] = Web3Client(chain_id)
    return _clients[chain_id]
