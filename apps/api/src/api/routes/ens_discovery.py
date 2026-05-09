"""ENS subname discovery endpoint (`/v1/ens/subnames`).

Lists all market subnames registered under kowalski.eth by scanning
SubnameRegistered events from the MarketSubnameRegistrar contract
on Ethereum Sepolia.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from web3 import Web3

_BUNDLED_ABI_DIR = Path(__file__).parent.parent / "abi"
_ARTIFACTS_ROOT = (
    Path(__file__).parent.parent.parent.parent.parent.parent
    / "apps/contracts/packages/hardhat/artifacts/contracts"
)

_ETH_SEPOLIA_CHAIN = 11155111
_DEPLOY_BLOCK = int(os.getenv("ENS_REGISTRAR_DEPLOY_BLOCK", "10822559"))

router = APIRouter(prefix="/v1/ens", tags=["free"])


def _load_abi(sol_path: str, contract_name: str) -> list[dict[str, Any]]:
    sol_dir = os.path.dirname(sol_path)
    bundled = _BUNDLED_ABI_DIR / sol_dir / f"{contract_name}.json"
    if bundled.exists():
        with open(bundled) as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else data["abi"]  # type: ignore[no-any-return]
    hardhat = _ARTIFACTS_ROOT / sol_path / f"{contract_name}.json"
    with open(hardhat) as fh:
        return json.load(fh)["abi"]  # type: ignore[no-any-return]


class SubnameEntry(BaseModel):
    slug: str
    ens_name: str
    market_id: int
    node: str


class SubnamesResponse(BaseModel):
    parent: str
    subnames: list[SubnameEntry]
    total: int


@router.get(
    "/subnames",
    response_model=SubnamesResponse,
    summary="List all ENS market subnames",
    description=(
        "Scans SubnameRegistered events from the MarketSubnameRegistrar "
        "on Ethereum Sepolia to enumerate all market subnames under kowalski.eth."
    ),
)
async def list_subnames() -> SubnamesResponse:
    registrar_addr = os.getenv("ENS_REGISTRAR_ADDRESS", "")
    rpc_url = os.getenv("RPC_URL_11155111", "https://ethereum-sepolia-rpc.publicnode.com")

    if not registrar_addr:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ENS_REGISTRAR_ADDRESS not configured",
        )

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    abi = _load_abi("ens/MarketSubnameRegistrar.sol", "MarketSubnameRegistrar")
    registrar = w3.eth.contract(
        address=Web3.to_checksum_address(registrar_addr),
        abi=abi,
    )

    logs = registrar.events.SubnameRegistered().get_logs(
        fromBlock=_DEPLOY_BLOCK,
        toBlock="latest",
    )

    entries: list[SubnameEntry] = []
    for log in logs:
        slug: str = log.args["slug"]
        entries.append(
            SubnameEntry(
                slug=slug,
                ens_name=f"{slug}.kowalski.eth",
                market_id=log.args["marketId"],
                node="0x" + log.args["node"].hex(),
            )
        )

    return SubnamesResponse(
        parent="kowalski.eth",
        subnames=entries,
        total=len(entries),
    )
