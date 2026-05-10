"""ENS indexer bridge (Track 1, §3.3 of ENS spec).

Subscribes to PredictionMarketV2 events on Base Sepolia (chain 84532)
and calls MarketResolver.setText on Ethereum Sepolia (chain 11155111)
to keep ENS text records fresh.

Events handled:
  - MarketCreated  → register subname + set initial text records
  - MarketResolved → update status, outcome, payouts
  - MarketCanceled → update status

This runs as a background task within the FastAPI lifespan, polling
for new events every ENS_BRIDGE_POLL_SECONDS (default 15).

Env vars:
  ENS_BRIDGE_ENABLED           — set to "1" to activate (default off)
  ENS_BRIDGE_POLL_SECONDS      — polling interval (default 15)
  ENS_BRIDGE_SIGNER_PK         — private key for calling setText/registerMarket on Eth Sepolia
  ENS_REGISTRAR_ADDRESS        — MarketSubnameRegistrar on Eth Sepolia
  ENS_RESOLVER_ADDRESS         — MarketResolver on Eth Sepolia
  RPC_URL_11155111             — Ethereum Sepolia RPC
  RPC_URL_84532                — Base Sepolia RPC (already configured)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from sqlalchemy import select
from web3 import Web3

from api.db.models import IndexerCheckpoint
from api.db.session import SessionLocal
from api.lib.ens import slugify

logger = logging.getLogger(__name__)

_POLL_SECONDS = int(os.getenv("ENS_BRIDGE_POLL_SECONDS", "15"))
_ENABLED = os.getenv("ENS_BRIDGE_ENABLED", "") == "1"

_BASE_SEPOLIA_CHAIN = 84532
_ETH_SEPOLIA_CHAIN = 11155111

# Public RPCs cap getLogs at ~10k blocks. 5k stays well under.
_BACKFILL_CHUNK_BLOCKS = int(os.getenv("ENS_BRIDGE_CHUNK_BLOCKS", "5000"))

# When no checkpoint exists, start here. PMv2 deploy block on Base Sepolia.
_DEFAULT_START_BLOCK = int(os.getenv("BRIDGE_START_BLOCK_84532", "41289065"))

_CHECKPOINT_NAME = "ens_bridge_84532"

_BUNDLED_ABI_DIR = Path(__file__).parent.parent / "abi"
_ARTIFACTS_ROOT = (
    Path(__file__).parent.parent.parent.parent.parent.parent
    / "apps/contracts/packages/hardhat/artifacts/contracts"
)


def is_bridge_enabled() -> bool:
    return _ENABLED


def _load_abi(sol_path: str, contract_name: str) -> list[dict[str, Any]]:
    """Load ABI for `contract_name`.

    Prefers the bundled copy at `apps/api/src/api/abi/<dir>/<name>.json`
    (where `<dir>` mirrors the contract's source directory — empty for
    top-level contracts, "ens" for ENS contracts).  Falls back to the
    hardhat artifacts tree for local dev where ABIs aren't yet bundled.
    """
    sol_dir = os.path.dirname(sol_path)
    bundled = _BUNDLED_ABI_DIR / sol_dir / f"{contract_name}.json"
    if bundled.exists():
        with open(bundled) as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else data["abi"]  # type: ignore[no-any-return]
    hardhat = _ARTIFACTS_ROOT / sol_path / f"{contract_name}.json"
    with open(hardhat) as fh:
        return json.load(fh)["abi"]  # type: ignore[no-any-return]


class ENSBridge:
    """Polls PMv2 events on Base Sepolia and mirrors state to ENS on Eth Sepolia."""

    def __init__(self) -> None:
        base_rpc = os.getenv("RPC_URL_84532", "https://sepolia.base.org")
        eth_rpc = os.getenv("RPC_URL_11155111", "https://ethereum-sepolia-rpc.publicnode.com")

        self._base_w3 = Web3(Web3.HTTPProvider(base_rpc))
        self._eth_w3 = Web3(Web3.HTTPProvider(eth_rpc))

        signer_pk = os.getenv("ENS_BRIDGE_SIGNER_PK", "")
        if not signer_pk:
            raise RuntimeError("ENS_BRIDGE_SIGNER_PK not set")
        self._account = self._eth_w3.eth.account.from_key(signer_pk)

        pmv2_addr = os.getenv("PMV2_ADDRESS_84532", "")
        if not pmv2_addr:
            raise RuntimeError("PMV2_ADDRESS_84532 not set")
        pmv2_abi = _load_abi("PredictionMarketV2.sol", "PredictionMarketV2")
        self._pmv2 = self._base_w3.eth.contract(
            address=Web3.to_checksum_address(pmv2_addr),
            abi=pmv2_abi,
        )

        registrar_addr = os.getenv("ENS_REGISTRAR_ADDRESS", "")
        resolver_addr = os.getenv("ENS_RESOLVER_ADDRESS", "")
        if not registrar_addr or not resolver_addr:
            raise RuntimeError("ENS_REGISTRAR_ADDRESS or ENS_RESOLVER_ADDRESS not set")

        registrar_abi = _load_abi(
            "ens/MarketSubnameRegistrar.sol", "MarketSubnameRegistrar"
        )
        resolver_abi = _load_abi("ens/MarketResolver.sol", "MarketResolver")

        self._registrar = self._eth_w3.eth.contract(
            address=Web3.to_checksum_address(registrar_addr),
            abi=registrar_abi,
        )
        self._resolver = self._eth_w3.eth.contract(
            address=Web3.to_checksum_address(resolver_addr),
            abi=resolver_abi,
        )

        self._parent_node: bytes = self._registrar.functions.parentNode().call()

        self._last_block = 0

    async def run(self) -> None:
        self._last_block = await self._load_checkpoint()
        logger.info(
            "ENS bridge started at block %d, polling every %ds",
            self._last_block, _POLL_SECONDS,
        )

        while True:
            try:
                await self._poll()
            except Exception:
                logger.exception("ENS bridge poll error")
            await asyncio.sleep(_POLL_SECONDS)

    async def _poll(self) -> None:
        current = self._base_w3.eth.block_number
        if current <= self._last_block:
            return

        # Walk in fixed-size chunks so a public-RPC getLogs cap (~10k blocks)
        # never bites us during initial backfill, and so the checkpoint
        # advances incrementally — a crash mid-backfill resumes near the
        # last completed chunk instead of restarting from scratch.
        from_block = self._last_block + 1
        while from_block <= current:
            to_block = min(from_block + _BACKFILL_CHUNK_BLOCKS - 1, current)
            await self._handle_market_created(from_block, to_block)
            await self._handle_market_resolved(from_block, to_block)
            await self._handle_market_canceled(from_block, to_block)
            self._last_block = to_block
            await self._save_checkpoint(to_block)
            from_block = to_block + 1

    async def _load_checkpoint(self) -> int:
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(IndexerCheckpoint).where(
                        IndexerCheckpoint.name == _CHECKPOINT_NAME
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return _DEFAULT_START_BLOCK - 1  # so from_block == _DEFAULT_START_BLOCK
        return row.block_number

    async def _save_checkpoint(self, block_number: int) -> None:
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(IndexerCheckpoint).where(
                        IndexerCheckpoint.name == _CHECKPOINT_NAME
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(
                    IndexerCheckpoint(
                        name=_CHECKPOINT_NAME, block_number=block_number
                    )
                )
            else:
                row.block_number = block_number
            await session.commit()

    async def _handle_market_created(self, from_block: int, to_block: int) -> None:
        events = self._pmv2.events.MarketCreated().get_logs(
            from_block=from_block, to_block=to_block
        )
        for event in events:
            market_id = event.args["marketId"]
            logger.info("MarketCreated: marketId=%d", market_id)

            market = self._pmv2.functions.getMarket(market_id).call()
            slug = slugify(market[6])  # market.name is at index 6 in the struct
            if not slug:
                slug = f"market-{market_id}"

            existing_node = self._registrar.functions.marketNodes(market_id).call()
            already_registered = existing_node != b"\x00" * 32
            if already_registered:
                logger.info(
                    "Subname already registered for market %d, refreshing records only",
                    market_id,
                )
            else:
                try:
                    self._send_tx(
                        self._registrar.functions.registerMarket(slug, market_id)
                    )
                    logger.info("Registered subname: %s.kowalski.eth", slug)
                except Exception:
                    logger.exception(
                        "Failed to register subname for market %d", market_id
                    )
                    continue

            node = self._registrar.functions.marketNodes(market_id).call()
            pmv2_addr = self._pmv2.address

            texts = {
                "marketId": str(market_id),
                "status": "ACTIVE",
                "outcome": "pending",
                "expiresAt": str(market[11]),  # expiresAt index
                "creator": market[0],  # creator address
            }

            try:
                keys = list(texts.keys())
                values = list(texts.values())
                self._send_tx(
                    self._resolver.functions.setTexts(node, keys, values)
                )
                self._send_tx(
                    self._resolver.functions.setAddr(node, pmv2_addr)
                )
                self._send_tx(
                    self._resolver.functions.setMarketId(node, market_id)
                )
                logger.info("Set ENS records for %s.kowalski.eth", slug)
            except Exception:
                logger.exception("Failed to set records for market %d", market_id)

            try:
                self._update_markets_index(slug)
            except Exception:
                logger.exception(
                    "Failed to update markets index for slug %r (market %d)",
                    slug,
                    market_id,
                )

    async def _handle_market_resolved(self, from_block: int, to_block: int) -> None:
        events = self._pmv2.events.MarketResolved().get_logs(
            from_block=from_block, to_block=to_block
        )
        for event in events:
            market_id = event.args["marketId"]
            payouts = event.args["payouts"]
            logger.info("MarketResolved: marketId=%d", market_id)

            node = self._registrar.functions.marketNodes(market_id).call()
            if node == b"\x00" * 32:
                logger.warning("Market %d not registered in ENS", market_id)
                continue

            outcome = "pending"
            if len(payouts) >= 2:
                if payouts[0] > 0 and payouts[1] == 0:
                    outcome = "yes"
                elif payouts[0] == 0 and payouts[1] > 0:
                    outcome = "no"
                else:
                    outcome = "split"

            try:
                self._send_tx(
                    self._resolver.functions.setTexts(
                        node,
                        ["status", "outcome", "payouts"],
                        ["RESOLVED", outcome, str(list(payouts))],
                    )
                )
                logger.info("Updated ENS: market %d → RESOLVED (%s)", market_id, outcome)
            except Exception:
                logger.exception("Failed to update ENS for resolved market %d", market_id)

    async def _handle_market_canceled(self, from_block: int, to_block: int) -> None:
        events = self._pmv2.events.MarketCanceled().get_logs(
            from_block=from_block, to_block=to_block
        )
        for event in events:
            market_id = event.args["marketId"]
            logger.info("MarketCanceled: marketId=%d", market_id)

            node = self._registrar.functions.marketNodes(market_id).call()
            if node == b"\x00" * 32:
                continue

            try:
                self._send_tx(
                    self._resolver.functions.setTexts(
                        node,
                        ["status", "outcome"],
                        ["CANCELED", "invalid"],
                    )
                )
            except Exception:
                logger.exception("Failed to update ENS for canceled market %d", market_id)

    def _update_markets_index(self, new_slug: str) -> None:
        """Append *new_slug* to the JSON array stored in text("markets") on the parent node."""
        raw: str = self._resolver.functions.text(self._parent_node, "markets").call()
        try:
            slugs: list[str] = json.loads(raw) if raw else []
        except json.JSONDecodeError:
            logger.warning("text('markets') held non-JSON value %r — resetting", raw)
            slugs = []

        if new_slug in slugs:
            return

        slugs.append(new_slug)
        self._send_tx(
            self._resolver.functions.setText(
                self._parent_node,
                "markets",
                json.dumps(slugs),
            )
        )
        logger.info("markets index updated: %d slugs, added %r", len(slugs), new_slug)

    def _send_tx(self, fn: Any) -> Any:
        """Build, sign, and send a transaction on Ethereum Sepolia."""
        tx = fn.build_transaction(
            {
                "from": self._account.address,
                "nonce": self._eth_w3.eth.get_transaction_count(self._account.address),
                "gas": 500_000,
                "maxFeePerGas": self._eth_w3.eth.gas_price * 2,
                "maxPriorityFeePerGas": self._eth_w3.to_wei(1, "gwei"),
                "chainId": _ETH_SEPOLIA_CHAIN,
            }
        )
        signed = self._eth_w3.eth.account.sign_transaction(tx, self._account.key)
        tx_hash = self._eth_w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._eth_w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        if receipt["status"] != 1:
            raise RuntimeError(
                f"tx reverted: {tx_hash.hex()} (block {receipt['blockNumber']})"
            )
        logger.info("TX %s confirmed (block %d)", tx_hash.hex(), receipt["blockNumber"])
        return receipt
