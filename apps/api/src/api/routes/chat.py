"""Kowalsky in-app chat endpoint (POST /v1/chat).

Wraps the Gemini function-calling loop, calling the same tools as the
REST routes. Returns text + TxCards for the frontend to render.
"""

from __future__ import annotations

import os
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.session import get_session
from api.lib.web3_client import get_client
from api.llm.provider import ChatResult, run_chat
from api.llm.tool_registry import ToolContext

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MAX_MESSAGE_LENGTH = 2000
_DEFAULT_CHAIN_ID = int(os.getenv("CHAIN_ID", "31337"))
# Chains we have contract bindings + RPC defaults for (web3_client._CHAIN_DEFAULTS).
_SUPPORTED_CHAINS = frozenset({31337, 84532})

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/v1/chat", tags=["chat"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=_MAX_MESSAGE_LENGTH)

    @field_validator("content")
    @classmethod
    def _sanitize(cls, v: str) -> str:
        return _CONTROL_CHARS.sub("", v)[:_MAX_MESSAGE_LENGTH]


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    user_address: str | None = Field(default=None)
    # The chain the user's wallet is connected to. If absent, we fall back to
    # CHAIN_ID env. Reads + TxCard calldata are scoped to this chain.
    chain_id: int | None = Field(default=None, ge=1)

    @field_validator("user_address")
    @classmethod
    def _validate_address(cls, v: str | None) -> str | None:
        if v is not None and not _ADDR_RE.match(v):
            raise ValueError("user_address must be a 0x-prefixed 40-hex-char address")
        return v.lower() if v else None


class TxStep(BaseModel):
    to: str
    data: str
    value: str = "0"
    summary: str


class TxCardResponse(TxStep):
    chain_id: int
    requires: list[TxStep] = Field(default_factory=list)
    notice: str | None = None


class ChatResponse(BaseModel):
    text: str
    tx_cards: list[TxCardResponse]


# ---------------------------------------------------------------------------
# POST /v1/chat
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ChatResponse,
    summary="Chat with Kowalsky",
    description=(
        "Send conversation history and receive a reply plus any TxCards "
        "produced by prepare_* tool calls."
    ),
)
@limiter.limit("30/minute")
async def chat(
    body: ChatRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    chain_id = body.chain_id or _DEFAULT_CHAIN_ID
    if chain_id not in _SUPPORTED_CHAINS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported chain {chain_id}. "
                f"Supported: {sorted(_SUPPORTED_CHAINS)}."
            ),
        )

    client = get_client(chain_id)
    ctx = ToolContext(
        session=session,
        client=client,
        chain_id=chain_id,
        user_address=body.user_address,
    )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    result: ChatResult = await run_chat(messages, ctx)

    return ChatResponse(text=result.text, tx_cards=result.tx_cards)
