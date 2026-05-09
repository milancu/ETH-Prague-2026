"""Comments endpoints (`/markets/{market_id}/comments`).

GET  /markets/{market_id}/comments        — public, returns nested tree
POST /markets/{market_id}/comments        — requires wallet address in body
                                            (full SIWE auth wires in at T3.5)
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from api.db.models import Comment, Market
from api.db.session import get_session

_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


def _isoformat_z(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CommentNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author: str
    content: str
    created_at: datetime
    replies: list["CommentNode"] = Field(default_factory=list)

    @field_serializer("created_at")
    def _serialize_dt(self, v: datetime) -> str:
        return _isoformat_z(v)


class CommentCreate(BaseModel):
    author: str
    content: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None

    @field_validator("author")
    @classmethod
    def _normalize_address(cls, v: str) -> str:
        if not _ADDR_RE.match(v):
            raise ValueError("must be a 0x-prefixed 40-hex-char address")
        return v.lower()

    @field_validator("content")
    @classmethod
    def _strip_content(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("content must not be empty")
        return stripped


# ── Tree builder ──────────────────────────────────────────────────────────────

def _build_tree(rows: list[Comment]) -> list[CommentNode]:
    nodes: dict[int, CommentNode] = {
        r.id: CommentNode.model_validate(r) for r in rows  # type: ignore[arg-type]
    }
    roots: list[CommentNode] = []
    for row in rows:
        node = nodes[row.id]  # type: ignore[index]
        if row.parent_id is None:
            roots.append(node)
        elif row.parent_id in nodes:
            nodes[row.parent_id].replies.append(node)
    return roots


# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(tags=["comments"])


@router.get(
    "/markets/{market_id}/comments",
    response_model=list[CommentNode],
)
async def list_comments(
    market_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[CommentNode]:
    market_stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(market_stmt)).scalar_one_or_none()
    if market is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="market not found")

    stmt = (
        select(Comment)
        .where(Comment.market_id == market_id)
        .order_by(col(Comment.created_at).asc())
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return _build_tree(rows)


@router.post(
    "/markets/{market_id}/comments",
    response_model=CommentNode,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    market_id: int,
    body: CommentCreate,
    session: AsyncSession = Depends(get_session),
) -> CommentNode:
    market_stmt = select(Market).where(Market.market_id == market_id)
    market = (await session.execute(market_stmt)).scalar_one_or_none()
    if market is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="market not found")

    if body.parent_id is not None:
        parent_stmt = select(Comment).where(
            Comment.id == body.parent_id,
            Comment.market_id == market_id,
        )
        parent = (await session.execute(parent_stmt)).scalar_one_or_none()
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="parent comment not found in this market",
            )

    comment = Comment(
        market_id=market_id,
        parent_id=body.parent_id,
        author=body.author,
        content=body.content,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    return CommentNode.model_validate(comment)
