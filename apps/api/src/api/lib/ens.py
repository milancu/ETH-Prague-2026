"""Shared ENS slug/name helpers.

Used by both the indexer bridge (on-chain registration) and the API read
model (computed ``ens_name`` field) to guarantee identical slug derivation.
"""

from __future__ import annotations

import re

KOWALSKI_PARENT = "kowalski.eth"


def slugify(name: str) -> str:
    """Convert a market title to a DNS-safe slug (max 63 chars)."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug[:63]


def ens_name_for(market_id: int, title: str) -> str:
    slug = slugify(title) or f"market-{market_id}"
    return f"{slug}.{KOWALSKI_PARENT}"
