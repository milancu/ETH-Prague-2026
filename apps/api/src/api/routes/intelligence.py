"""Intelligence endpoints (`/v1/intelligence/*`) — paywalled via x402.

Phase 2: paywall tag applied, middleware in passthrough mode (no signature
required yet).  Phase 3 adds inbound x402 enforcement.

Cost schedule (USDC on Base mainnet, per §4.2 of docs/agents/ai_layer.md):
  /tweets, /reddit, /news, /analyze        $0.50
  /markets-with-buzz, /correlate-with-news $0.75

These costs are carried in the OpenAPI spec as x-x402-price extensions and
will be enforced by the PaymentMiddlewareASGI added in Phase 3.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.lib.apify_x402 import ApifyClientError
from api.llm.tools import apify as apify_tools

router = APIRouter(prefix="/v1/intelligence", tags=["paywall:x402"])


# ---------------------------------------------------------------------------
# Shared response fragments
# ---------------------------------------------------------------------------


class TweetItem(BaseModel):
    id: str
    author: str
    text: str
    ts: str
    url: str
    engagement: dict[str, int]


class ArticleItem(BaseModel):
    title: str
    source: str
    url: str
    ts: str
    snippet: str


class RedditPost(BaseModel):
    id: str
    title: str
    text: str
    subreddit: str
    score: int
    url: str
    ts: str | int


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class TweetsRequest(BaseModel):
    query: str = Field(min_length=1, description="Search query for Twitter/X")
    max_items: int = Field(default=20, ge=1, le=100)


class TweetsResponse(BaseModel):
    tweets: list[TweetItem]
    query: str
    source: str


class RedditRequest(BaseModel):
    query: str = Field(min_length=1)
    max_items: int = Field(default=20, ge=1, le=100)


class RedditResponse(BaseModel):
    posts: list[RedditPost]
    query: str
    source: str


class NewsRequest(BaseModel):
    query: str = Field(min_length=1)
    max_items: int = Field(default=20, ge=1, le=100)
    language: str = Field(default="en", max_length=5)


class NewsResponse(BaseModel):
    articles: list[ArticleItem]
    query: str
    source: str


class AnalyzeRequest(BaseModel):
    market_title: str = Field(min_length=1)
    category: str = Field(default="general")
    max_items: int = Field(default=15, ge=1, le=50)


class AnalyzeResponse(BaseModel):
    query: str
    tweets: list[TweetItem]
    articles: list[ArticleItem]
    sentiment: str | None
    thesis: str | None
    suggested_close_date: str | None
    sources: list[str]


class MarketBuzzRequest(BaseModel):
    market_titles: list[str] = Field(
        min_length=1, description="On-chain market titles to check for buzz"
    )
    max_tweets_per_market: int = Field(default=10, ge=1, le=50)


class MarketBuzzItem(BaseModel):
    title: str
    tweet_count: int
    top_tweet: TweetItem | None


class MarketBuzzResponse(BaseModel):
    results: list[MarketBuzzItem]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _apify_error(exc: ApifyClientError) -> HTTPException:
    msg = str(exc)
    if "X402_OUT_WALLET_PK" in msg:
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        code = status.HTTP_502_BAD_GATEWAY
    return HTTPException(status_code=code, detail=msg)


def _coerce_tweets(raw: list[dict[str, Any]]) -> list[TweetItem]:
    return [TweetItem(**t) for t in raw]


def _coerce_articles(raw: list[dict[str, Any]]) -> list[ArticleItem]:
    return [ArticleItem(**a) for a in raw]


# ---------------------------------------------------------------------------
# POST /v1/intelligence/tweets                                  ($0.50)
# ---------------------------------------------------------------------------


@router.post(
    "/tweets",
    response_model=TweetsResponse,
    summary="Fetch tweets for a query",
    description=(
        "Calls `apidojo/twitter-scraper-lite` via x402. "
        "**Paywall: $0.50 USDC on Base mainnet (Phase 3).**"
    ),
    openapi_extra={"x-x402-price": "$0.50", "x-x402-network": "eip155:84532"},
)
async def get_tweets(body: TweetsRequest) -> TweetsResponse:
    try:
        result = await apify_tools.fetch_tweets(body.query, body.max_items)
    except ApifyClientError as exc:
        raise _apify_error(exc) from exc
    return TweetsResponse(
        tweets=_coerce_tweets(result["tweets"]),
        query=result["query"],
        source=result["source"],
    )


# ---------------------------------------------------------------------------
# POST /v1/intelligence/reddit                                  ($0.50)
# ---------------------------------------------------------------------------


@router.post(
    "/reddit",
    response_model=RedditResponse,
    summary="Fetch Reddit posts for a query",
    description=(
        "Calls `webdatalabs/reddit-scraper-pro` via x402. "
        "**Paywall: $0.50 USDC on Base mainnet (Phase 3).**"
    ),
    openapi_extra={"x-x402-price": "$0.50", "x-x402-network": "eip155:84532"},
)
async def get_reddit(body: RedditRequest) -> RedditResponse:
    try:
        result = await apify_tools.fetch_reddit(body.query, body.max_items)
    except ApifyClientError as exc:
        raise _apify_error(exc) from exc
    return RedditResponse(
        posts=[RedditPost(**p) for p in result["posts"]],
        query=result["query"],
        source=result["source"],
    )


# ---------------------------------------------------------------------------
# POST /v1/intelligence/news                                    ($0.50)
# ---------------------------------------------------------------------------


@router.post(
    "/news",
    response_model=NewsResponse,
    summary="Fetch news articles for a query",
    description=(
        "Calls `automation-lab/google-news-scraper` via x402. "
        "**Paywall: $0.50 USDC on Base mainnet (Phase 3).**"
    ),
    openapi_extra={"x-x402-price": "$0.50", "x-x402-network": "eip155:84532"},
)
async def get_news(body: NewsRequest) -> NewsResponse:
    try:
        result = await apify_tools.fetch_news(body.query, body.max_items, body.language)
    except ApifyClientError as exc:
        raise _apify_error(exc) from exc
    return NewsResponse(
        articles=_coerce_articles(result["articles"]),
        query=result["query"],
        source=result["source"],
    )


# ---------------------------------------------------------------------------
# POST /v1/intelligence/analyze                                 ($0.50)
# ---------------------------------------------------------------------------


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Aggregate tweets + news for a market",
    description=(
        "Fetches tweets and news for the market title and returns raw sources. "
        "LLM-driven sentiment / thesis is added in Phase 3+. "
        "**Paywall: $0.50 USDC on Base mainnet (Phase 3).**"
    ),
    openapi_extra={"x-x402-price": "$0.50", "x-x402-network": "eip155:84532"},
)
async def analyze_market(body: AnalyzeRequest) -> AnalyzeResponse:
    try:
        result = await apify_tools.analyze_market(
            body.market_title, body.category, body.max_items
        )
    except ApifyClientError as exc:
        raise _apify_error(exc) from exc
    return AnalyzeResponse(
        query=result["query"],
        tweets=_coerce_tweets(result["tweets"]),
        articles=_coerce_articles(result["articles"]),
        sentiment=result["sentiment"],
        thesis=result["thesis"],
        suggested_close_date=result["suggested_close_date"],
        sources=result["sources"],
    )


# ---------------------------------------------------------------------------
# POST /v1/intelligence/markets-with-buzz                       ($0.75)
# ---------------------------------------------------------------------------


@router.post(
    "/markets-with-buzz",
    response_model=MarketBuzzResponse,
    summary="Rank markets by Twitter buzz",
    description=(
        "Returns tweet count and top tweet for each supplied market title. "
        "**Paywall: $0.75 USDC on Base mainnet (Phase 3).**"
    ),
    openapi_extra={"x-x402-price": "$0.75", "x-x402-network": "eip155:84532"},
)
async def markets_with_buzz(body: MarketBuzzRequest) -> MarketBuzzResponse:
    try:
        items = await apify_tools.markets_with_buzz(
            body.market_titles, body.max_tweets_per_market
        )
    except ApifyClientError as exc:
        raise _apify_error(exc) from exc
    results = [
        MarketBuzzItem(
            title=it["title"],
            tweet_count=it["tweet_count"],
            top_tweet=TweetItem(**it["top_tweet"]) if it["top_tweet"] else None,
        )
        for it in items
    ]
    return MarketBuzzResponse(results=results)
