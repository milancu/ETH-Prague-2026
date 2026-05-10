"""Verifiable randomness client for CLOB tiebreaking.

Pulls fresh entropy from the SpaceComputer cTRNG beacon (IPNS),
caches it for SPACECOMPUTER_SEED_TTL_S seconds, and seeds a Python
Random instance with per-call salt so concurrent requests diverge.

Used ONLY from orderbook.py. Everything else uses stdlib random.
"""

from __future__ import annotations

import hashlib
import time
from random import Random
from typing import Protocol

import httpx


class RandomnessSource(Protocol):
    def fresh_random(self) -> Random: ...


class FifoSentinel:
    """Signals the caller to use FIFO ordering, not shuffle."""

    def fresh_random(self) -> Random:
        raise RuntimeError("FifoSentinel.fresh_random() — caller bug")


class SpaceComputerRandomness:
    def __init__(self, url: str, api_key: str | None, ttl_s: int) -> None:
        self._url = url
        self._api_key = api_key
        self._ttl_s = ttl_s
        self._cached_seed: bytes | None = None
        self._cached_at: float = 0.0

    def _fetch_seed(self) -> bytes:
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        resp = httpx.get(self._url, headers=headers, timeout=5.0)
        resp.raise_for_status()
        ctrng: list[str] = resp.json()["data"]["ctrng"]
        raw = b"".join(bytes.fromhex(v) for v in ctrng)
        return hashlib.sha256(raw).digest()

    def fresh_random(self) -> Random:
        now = time.monotonic()
        if self._cached_seed is None or (now - self._cached_at) > self._ttl_s:
            self._cached_seed = self._fetch_seed()
            self._cached_at = now
        salt = hashlib.sha256(
            self._cached_seed + time.monotonic_ns().to_bytes(8, "big")
        ).digest()
        return Random(int.from_bytes(salt, "big"))


def get_randomness_source() -> RandomnessSource:
    from api.lib.settings import settings

    if settings.clob_match_tiebreaker == "fifo":
        return FifoSentinel()
    if not settings.spacecomputer_api_url:
        raise RuntimeError(
            "CLOB_MATCH_TIEBREAKER=random vyžaduje SPACECOMPUTER_API_URL"
        )
    return SpaceComputerRandomness(
        url=settings.spacecomputer_api_url,
        api_key=settings.spacecomputer_api_key,
        ttl_s=settings.spacecomputer_seed_ttl_s,
    )
