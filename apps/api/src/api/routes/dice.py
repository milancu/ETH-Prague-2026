"""Cosmic dice market endpoints — commit, link, reveal.

POST /v1/dice/commit     — create commitment + market TxCard
POST /v1/dice/{id}/link  — link on-chain market_id to commitment
POST /v1/dice/{id}/reveal — reveal result + resolve TxCard
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import DiceCommitment
from api.db.session import get_session
from api.lib.web3_client import get_client
from api.llm.tools import dice as dice_tools

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


class DiceCommitRequest(BaseModel):
    name: str = Field(min_length=1, description="Market title")
    description: str = Field(default="", description="Market description")
    delay_minutes: float = Field(
        default=5.0, gt=0, description="Minutes until the dice roll"
    )
    user_address: str = Field(description="Creator wallet address (= oracle)")
    chain_id: int = Field(default=31337)

    @field_validator("user_address")
    @classmethod
    def _validate_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be 0x-prefixed 40-hex-char address")
        return v.lower()


class DiceLinkRequest(BaseModel):
    market_id: int = Field(ge=0, description="On-chain market ID after tx confirms")


router = APIRouter(prefix="/v1/dice", tags=["dice"])


@router.post(
    "/commit",
    summary="Create a cosmic dice commitment + market TxCard",
    description=(
        "Commits to a future SpaceComputer beacon block, creates a 6-outcome "
        "dice market TxCard. The user signs the TxCard, then links the on-chain "
        "market_id via POST /v1/dice/{id}/link."
    ),
)
async def dice_commit(
    body: DiceCommitRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    client = get_client(body.chain_id)
    try:
        return await dice_tools.prepare_create_dice_market(
            session,
            client,
            body.name,
            body.description,
            body.delay_minutes,
            body.user_address,
            body.chain_id,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post(
    "/{commitment_id}/link",
    summary="Link on-chain market_id to a dice commitment",
    description=(
        "After the user signs the createMarket tx and it confirms, POST the "
        "resulting market_id here so the reveal step knows which market to resolve."
    ),
)
async def dice_link(
    commitment_id: int,
    body: DiceLinkRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    commitment = await session.get(DiceCommitment, commitment_id)
    if commitment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dice commitment #{commitment_id} not found",
        )
    if commitment.market_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Commitment #{commitment_id} already linked "
                f"to market #{commitment.market_id}"
            ),
        )
    commitment.market_id = body.market_id
    session.add(commitment)
    await session.commit()
    return {"status": "linked", "market_id": str(body.market_id)}


@router.post(
    "/{commitment_id}/reveal",
    summary="Reveal cosmic dice result + resolve TxCard",
    description=(
        "Fetches the committed beacon block, derives the die roll, and returns "
        "a resolveMarket TxCard. Returns status=not_ready with eta_seconds if "
        "the beacon block is not yet available."
    ),
)
async def dice_reveal(
    commitment_id: int,
    chain_id: int = 31337,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    client = get_client(chain_id)
    return await dice_tools.reveal_dice_market(
        session,
        client,
        commitment_id,
        chain_id,
    )
