"""SpaceComputer cTRNG cosmic dice — commit-reveal service.

Commit: snapshot current beacon state, compute target sequence, persist
        a tamper-evident DiceCommitment row.
Reveal: fetch the target beacon block (walk-back via `previous` CID chain),
        derive deterministic die roll, return result + resolve payouts.

Algorithm (matches _reference/dice.py and index.html 1:1):
  1. raw    = bytes(ctrng[0]) || bytes(ctrng[1]) || bytes(ctrng[2])
  2. seed   = SHA256(raw)
  3. stream = SHA256(seed || uint32_BE(0)) || SHA256(seed || uint32_BE(1)) || ...
  4. Draw bytes; accept b iff b < 252 (rejection sampling, no modulo bias)
  5. die = (b % 6) + 1
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass

import httpx

from api.lib.settings import settings

BEACON_INTERVAL_SEC = 60
IPFS_GATEWAY = "https://ipfs.io"


@dataclass
class CommitmentData:
    commitment_hash: str
    target_sequence: int
    delay_minutes: float
    current_sequence: int
    estimated_reveal_unix: int


@dataclass
class RevealResult:
    die: int
    seed_hex: str
    ctrng: list[str]
    beacon_sequence: int
    beacon_timestamp: int
    payouts: list[int]


class DiceNotReadyError(Exception):
    def __init__(self, eta_seconds: int) -> None:
        self.eta_seconds = eta_seconds
        super().__init__(f"Target block not yet available. ETA: {eta_seconds}s")


def _beacon_url() -> str:
    url = settings.spacecomputer_api_url
    if not url:
        raise RuntimeError(
            "SPACECOMPUTER_API_URL required for dice markets"
        )
    return url


def _beacon_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.spacecomputer_api_key:
        headers["Authorization"] = f"Bearer {settings.spacecomputer_api_key}"
    return headers


def _fetch_json(url: str) -> dict:
    resp = httpx.get(url, headers=_beacon_headers(), timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def fetch_latest_block() -> dict:
    return _fetch_json(_beacon_url())


def fetch_block_by_cid(cid_or_path: str) -> dict:
    cid = cid_or_path
    if cid.startswith("/ipfs/"):
        cid = cid[len("/ipfs/"):]
    return _fetch_json(f"{IPFS_GATEWAY}/ipfs/{cid}")


def fetch_block_by_sequence(target_seq: int) -> dict:
    block = fetch_latest_block()
    current_seq = block["data"]["sequence"]
    if target_seq > current_seq:
        eta = (target_seq - current_seq) * BEACON_INTERVAL_SEC
        raise DiceNotReadyError(eta)

    while block["data"]["sequence"] > target_seq:
        prev = block.get("previous")
        if not prev:
            raise RuntimeError(
                "Reached genesis without finding the target sequence."
            )
        block = fetch_block_by_cid(prev)

    if block["data"]["sequence"] != target_seq:
        raise RuntimeError(
            f"Beacon chain skipped target — found {block['data']['sequence']}, "
            f"expected {target_seq}."
        )
    return block


def derive_die_roll(ctrng_values: list[str]) -> dict[str, str | int]:
    raw = b"".join(bytes.fromhex(v) for v in ctrng_values)
    seed = hashlib.sha256(raw).digest()

    ctr = 0
    while True:
        block = hashlib.sha256(seed + ctr.to_bytes(4, "big")).digest()
        for b in block:
            if b < 252:
                return {"seed_hex": seed.hex(), "die": (b % 6) + 1}
        ctr += 1


def _commitment_hash(commitment_dict: dict) -> str:
    canonical = json.dumps(commitment_dict, indent=2, sort_keys=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def create_commitment(delay_minutes: float) -> CommitmentData:
    latest = fetch_latest_block()
    current_seq: int = latest["data"]["sequence"]
    current_ts: int = latest["data"]["timestamp"]

    blocks_to_wait = max(1, math.ceil(delay_minutes * 60 / BEACON_INTERVAL_SEC))
    target_seq = current_seq + blocks_to_wait
    target_eta_unix = current_ts + blocks_to_wait * BEACON_INTERVAL_SEC

    commitment = {
        "scheme_version": "1.0",
        "beacon_ipns": "k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f",
        "current_sequence": current_seq,
        "target_sequence": target_seq,
        "delay_minutes": delay_minutes,
        "wall_clock_unix": int(time.time()),
    }
    h = _commitment_hash(commitment)

    return CommitmentData(
        commitment_hash=h,
        target_sequence=target_seq,
        delay_minutes=delay_minutes,
        current_sequence=current_seq,
        estimated_reveal_unix=target_eta_unix,
    )


def reveal(target_sequence: int) -> RevealResult:
    block = fetch_block_by_sequence(target_sequence)
    ctrng: list[str] = block["data"]["ctrng"]
    seq: int = block["data"]["sequence"]
    ts: int = block["data"]["timestamp"]

    result = derive_die_roll(ctrng)
    die = int(result["die"])

    # payouts for resolveMarket: 6-slot array, 1 at (die-1), rest 0
    payouts = [0] * 6
    payouts[die - 1] = 1

    return RevealResult(
        die=die,
        seed_hex=str(result["seed_hex"]),
        ctrng=ctrng,
        beacon_sequence=seq,
        beacon_timestamp=ts,
        payouts=payouts,
    )
