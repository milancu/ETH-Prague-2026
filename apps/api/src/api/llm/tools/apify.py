"""Apify actor wrappers — fetch tweets, reddit posts, and news via x402.

All functions are async (Apify calls are network-bound).  They return
structured dicts; routes wrap them in Pydantic response models.

Actor slugs are env-configurable so they can be swapped without touching call
sites (docs/agents/ai_layer.md §10).
"""

from __future__ import annotations

import os
from typing import Any, cast

from api.lib.apify_x402 import ApifyClientError, build_apify_client

_BASE_URL = os.getenv("APIFY_BASE_URL", "https://api.apify.com")

_ACTOR_TWITTER = os.getenv(
    "APIFY_ACTOR_TWITTER", "apidojo/twitter-scraper-lite"
)
_ACTOR_REDDIT = os.getenv(
    "APIFY_ACTOR_REDDIT", "webdatalabs/reddit-scraper-pro"
)
_ACTOR_NEWS = os.getenv(
    "APIFY_ACTOR_NEWS", "automation-lab/google-news-scraper"
)

# Apify sync endpoint: POST /v2/acts/{actorId}/run-sync-get-dataset-items
_RUN_SYNC = "/v2/acts/{actor}/run-sync-get-dataset-items"


async def _run_actor(actor: str, input_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Run an Apify actor via x402 and return the dataset items."""
    url = _BASE_URL + _RUN_SYNC.format(actor=actor)
    async with build_apify_client() as client:
        response = await client.post(
            url,
            json=input_data,
            timeout=120.0,
        )
    if response.status_code != 200:
        raise ApifyClientError(
            f"Apify actor {actor!r} returned {response.status_code}: "
            f"{response.text[:200]}"
        )
    data: Any = response.json()
    # Apify sync endpoint may return items directly or wrapped
    if isinstance(data, list):
        return cast(list[dict[str, Any]], data)
    return cast(list[dict[str, Any]], data.get("items", data.get("data", [])))


# ---------------------------------------------------------------------------
# Tweets
# ---------------------------------------------------------------------------


async def fetch_tweets(
    query: str,
    max_items: int = 20,
) -> dict[str, Any]:
    """Search Twitter/X for `query` and return recent tweets."""
    items = await _run_actor(
        _ACTOR_TWITTER,
        {"searchTerms": [query], "maxItems": max_items},
    )
    tweets = [
        {
            "id": t.get("id", t.get("tweetId", "")),
            "author": t.get("author", {}).get("userName", t.get("username", "")),
            "text": t.get("text", t.get("fullText", "")),
            "ts": t.get("createdAt", ""),
            "url": t.get("url", ""),
            "engagement": {
                "likes": t.get("likeCount", 0),
                "retweets": t.get("retweetCount", 0),
                "replies": t.get("replyCount", 0),
            },
        }
        for t in items
    ]
    return {"tweets": tweets, "query": query, "source": "apify/twitter-scraper-lite"}


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------


async def fetch_reddit(
    query: str,
    max_items: int = 20,
) -> dict[str, Any]:
    """Fetch Reddit posts matching `query`."""
    items = await _run_actor(
        _ACTOR_REDDIT,
        {"searches": [{"query": query, "maxItems": max_items}]},
    )
    posts = [
        {
            "id": p.get("id", ""),
            "title": p.get("title", ""),
            "text": p.get("selftext", p.get("body", ""))[:500],
            "subreddit": p.get("subreddit", ""),
            "score": p.get("score", 0),
            "url": p.get("url", ""),
            "ts": p.get("created_utc", p.get("createdAt", "")),
        }
        for p in items
    ]
    return {"posts": posts, "query": query, "source": "apify/reddit-scraper-pro"}


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------


async def fetch_news(
    query: str,
    max_items: int = 20,
    language: str = "en",
) -> dict[str, Any]:
    """Fetch Google News articles for `query`."""
    items = await _run_actor(
        _ACTOR_NEWS,
        {"query": query, "maxItems": max_items, "language": language},
    )
    articles = [
        {
            "title": a.get("title", ""),
            "source": a.get("source", a.get("publisher", "")),
            "url": a.get("url", a.get("link", "")),
            "ts": a.get("date", a.get("publishedAt", "")),
            "snippet": a.get("description", a.get("snippet", ""))[:300],
        }
        for a in items
    ]
    return {
        "articles": articles,
        "query": query,
        "source": "apify/google-news-scraper",
    }


# ---------------------------------------------------------------------------
# analyze_market — scrape + return raw intelligence (LLM summary in Phase 3+)
# ---------------------------------------------------------------------------


async def analyze_market(
    market_title: str,
    category: str = "general",
    max_items: int = 15,
) -> dict[str, Any]:
    """Aggregate tweets and news for a market topic.

    Returns raw sources — caller does own summarisation.
    LLM-driven sentiment analysis is a Phase 3+ addition.
    """
    query = market_title
    tweets_result = await fetch_tweets(query, max_items=max_items)
    news_result = await fetch_news(query, max_items=max_items)

    return {
        "query": query,
        "tweets": tweets_result["tweets"],
        "articles": news_result["articles"],
        "suggested_close_date": None,  # TODO: LLM infers from context in Phase 3+
        "sentiment": None,             # TODO: LLM in Phase 3+
        "thesis": None,                # TODO: LLM in Phase 3+
        "sources": [
            tweets_result["source"],
            news_result["source"],
        ],
    }


# ---------------------------------------------------------------------------
# markets_with_buzz — tweet count per known market title
# ---------------------------------------------------------------------------


async def markets_with_buzz(
    market_titles: list[str],
    max_tweets_per_market: int = 10,
) -> list[dict[str, Any]]:
    """Return tweet count and top tweet for each market title."""
    results = []
    for title in market_titles:
        try:
            tw = await fetch_tweets(title, max_items=max_tweets_per_market)
            tweets = tw["tweets"]
            results.append(
                {
                    "title": title,
                    "tweet_count": len(tweets),
                    "top_tweet": tweets[0] if tweets else None,
                }
            )
        except ApifyClientError:
            results.append({"title": title, "tweet_count": 0, "top_tweet": None})
    return results
