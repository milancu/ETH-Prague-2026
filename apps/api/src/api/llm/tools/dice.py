"""Dice market tools — commit-reveal cosmic dice powered by SpaceComputer cTRNG.

Workflow:
  1. prepare_create_dice_market → creates commitment + market TxCard
  2. (user signs & creates market on-chain)
  3. (user links market_id to commitment via POST /v1/dice/{commitment_id}/link)
  4. reveal_dice_market → fetches beacon, derives result, returns resolve TxCard
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from api.db.models import DiceCommitment, Market
from api.lib.dice import (
    DiceNotReadyError,
    create_commitment,
    reveal,
)
from api.lib.web3_client import Web3Client
from api.llm.tools import prepare as prepare_tools

DICE_OUTCOME_LABELS = ["1", "2", "3", "4", "5", "6"]
DICE_SLOT_COUNT = 6
DICE_OUTCOME_TYPE = 1  # MULTI


async def prepare_create_dice_market(
    session: AsyncSession,
    client: Web3Client,
    name: str,
    description: str,
    delay_minutes: float,
    user_address: str,
    chain_id: int,
) -> dict[str, Any]:
    commitment = await asyncio.to_thread(create_commitment, delay_minutes)

    # expires_at = target ETA, resolution_time = target ETA + 60s buffer
    expires_at = commitment.estimated_reveal_unix
    resolution_time = commitment.estimated_reveal_unix + 60

    card = await asyncio.to_thread(
        prepare_tools.prepare_create_market,
        client,
        name,
        description,
        "dice",
        DICE_OUTCOME_TYPE,
        DICE_SLOT_COUNT,
        DICE_OUTCOME_LABELS,
        user_address,  # creator = oracle
        expires_at,
        resolution_time,
        chain_id,
    )

    db_commitment = DiceCommitment(
        commitment_hash=commitment.commitment_hash,
        target_sequence=commitment.target_sequence,
        delay_minutes=commitment.delay_minutes,
        current_sequence=commitment.current_sequence,
        estimated_reveal_unix=commitment.estimated_reveal_unix,
    )
    session.add(db_commitment)
    await session.commit()
    await session.refresh(db_commitment)

    return {
        "status": "tx_card_created",
        "summary": card.get("summary", ""),
        "tx_card": card,
        "commitment": {
            "id": db_commitment.id,
            "commitment_hash": commitment.commitment_hash,
            "target_sequence": commitment.target_sequence,
            "estimated_reveal_unix": commitment.estimated_reveal_unix,
            "delay_minutes": commitment.delay_minutes,
        },
    }


async def link_dice_market(
    session: AsyncSession,
    commitment_id: int,
    market_id: int,
) -> dict[str, Any]:
    commitment = await session.get(DiceCommitment, commitment_id)
    if commitment is None:
        return {"error": f"Dice commitment #{commitment_id} not found"}

    if commitment.market_id is not None:
        return {
            "error": (
                f"Commitment #{commitment_id} already linked "
                f"to market #{commitment.market_id}"
            )
        }

    commitment.market_id = market_id
    session.add(commitment)
    await session.commit()
    return {"status": "linked", "commitment_id": commitment_id, "market_id": market_id}


async def reveal_dice_market(
    session: AsyncSession,
    client: Web3Client,
    commitment_id: int,
    chain_id: int,
) -> dict[str, Any]:
    commitment = await session.get(DiceCommitment, commitment_id)
    if commitment is None:
        return {"error": f"Dice commitment #{commitment_id} not found"}

    if commitment.result is not None:
        return {
            "status": "already_revealed",
            "die": commitment.result,
            "seed_hex": commitment.seed_hex,
        }

    if commitment.market_id is None:
        return {
            "error": (
                "No market_id linked to this commitment yet. "
                "The user must create the market on-chain first, then link it."
            )
        }

    stmt = select(Market).where(Market.market_id == commitment.market_id)
    market = (await session.execute(stmt)).scalar_one_or_none()
    if market is None:
        return {"error": f"Market #{commitment.market_id} not found in DB"}

    try:
        result = await asyncio.to_thread(reveal, commitment.target_sequence)
    except DiceNotReadyError as exc:
        return {
            "status": "not_ready",
            "eta_seconds": exc.eta_seconds,
            "target_sequence": commitment.target_sequence,
        }

    commitment.ctrng = result.ctrng
    commitment.seed_hex = result.seed_hex
    commitment.result = result.die
    commitment.revealed_at = datetime.now(UTC)
    session.add(commitment)
    await session.commit()

    card = await asyncio.to_thread(
        prepare_tools.prepare_resolve_market,
        client,
        commitment.market_id,
        result.payouts,
        chain_id,
    )

    return {
        "status": "tx_card_created",
        "summary": card.get("summary", ""),
        "tx_card": card,
        "die": result.die,
        "seed_hex": result.seed_hex,
        "ctrng": result.ctrng,
        "beacon_sequence": result.beacon_sequence,
        "payouts": result.payouts,
    }
