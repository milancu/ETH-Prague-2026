"""Shared ENS slug/name helpers.

Used by both the indexer bridge (on-chain registration) and the API read
model (computed ``ens_name`` field) to guarantee identical slug derivation.
"""

from __future__ import annotations

import re

from unidecode import unidecode

KOWALSKI_PARENT = "kowalski.eth"


def slugify(name: str) -> str:
    """Convert a market title to a DNS-safe slug (max 40 chars).

    Transliterates non-ASCII (incl. Czech diacritics) so that
    "Česko vs Švédsko" -> "cesko-vs-svedsko" instead of
    "esko-vs-vdsko".
    """
    slug = unidecode(name).lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug[:40]


def ens_name_for(market_id: int, title: str) -> str:
    """Return the on-chain subname for a market."""
    slug = slugify(title) or f"market-{market_id}"
    return f"{slug}.{KOWALSKI_PARENT}"


def ens_analysis_name_for(market_id: int, title: str) -> str:
    """Return the virtual analysis subname for a market.

    NOT registered on-chain — this is an API/UI convention pointing
    consumers at the same `<slug>.kowalski.eth` records (which carry
    the `api` and `price` text records for the x402 intelligence
    endpoint).
    """
    slug = slugify(title) or f"market-{market_id}"
    return f"analysis-{slug}.{KOWALSKI_PARENT}"
