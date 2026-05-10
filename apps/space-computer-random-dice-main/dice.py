#!/usr/bin/env python3
"""
SpaceComputer cTRNG dice roller with commit-reveal verification.

Two modes:
  commit  — declare a future draw NOW, save a tamper-evident commitment
  reveal  — later, fetch the committed beacon block and compute the result

Output (deterministic from the committed beacon block):
  • result — single die roll, uniform on 1..6

Usage:
  python dice.py commit 5          # commit to a draw in 5 minutes
  python dice.py commit 60         # commit to a draw in 1 hour
  python dice.py reveal            # execute the committed draw

Zero external dependencies (standard library only).
"""

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

# ---------------------------------------------------------------------------
# Beacon configuration (from https://docs.spacecomputer.io/docs/how-to/ctrng)
# ---------------------------------------------------------------------------
BEACON_IPNS = "k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f"
BEACON_URL = f"https://ipfs.io/ipns/{BEACON_IPNS}"
IPFS_GATEWAY = "https://ipfs.io"
BEACON_INTERVAL_SEC = 60          # beacon publishes one block per minute
COMMIT_FILE = Path("commitment.json")


# ---------------------------------------------------------------------------
# Beacon I/O
# ---------------------------------------------------------------------------
def fetch_json(url, timeout=30):
    with urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def fetch_latest_block():
    """The IPNS address always resolves to the most recent beacon block."""
    return fetch_json(BEACON_URL)


def fetch_block_by_cid(cid_or_path):
    """Fetch a historical block via its IPFS CID (the `previous` field)."""
    cid = cid_or_path
    if cid.startswith("/ipfs/"):
        cid = cid[len("/ipfs/"):]
    return fetch_json(f"{IPFS_GATEWAY}/ipfs/{cid}")


def fetch_block_by_sequence(target_seq, verbose=True):
    """
    Walk the `previous` chain from the latest block back to the target sequence.
    The beacon is content-addressed, so this is deterministic and tamper-evident.
    """
    block = fetch_latest_block()
    current_seq = block["data"]["sequence"]
    if target_seq > current_seq:
        eta = (target_seq - current_seq) * BEACON_INTERVAL_SEC
        raise ValueError(
            f"Target sequence {target_seq} is still in the future "
            f"(latest is {current_seq}). Wait ~{eta} seconds."
        )

    distance = current_seq - target_seq
    if verbose and distance > 10:
        print(f"  walking back {distance} blocks (latest={current_seq}, target={target_seq})...")

    while block["data"]["sequence"] > target_seq:
        prev = block.get("previous")
        if not prev:
            raise RuntimeError("Reached genesis without finding the target sequence.")
        block = fetch_block_by_cid(prev)

    if block["data"]["sequence"] != target_seq:
        raise RuntimeError(
            f"Beacon chain skipped the target — found {block['data']['sequence']}, "
            f"expected {target_seq}."
        )
    return block


# ---------------------------------------------------------------------------
# Deterministic die derivation
# ---------------------------------------------------------------------------
def derive_die_roll(ctrng_values):
    """
    Deterministic, bias-free derivation of a single d6 from the cTRNG block.

    Algorithm (matches index.html 1:1):
      1.  raw    = bytes(ctrng[0]) || bytes(ctrng[1]) || bytes(ctrng[2])
      2.  seed   = SHA256(raw)                                    -> 32 bytes
      3.  stream = SHA256(seed || uint32_BE(0))
                || SHA256(seed || uint32_BE(1)) || ...            -> infinite
      4.  Draw bytes from stream; accept byte b iff b < 252
            (252 = 6 * 42; rejection sampling kills modulo bias).
      5.  die  = (first accepted b % 6) + 1
    """
    raw = b"".join(bytes.fromhex(v) for v in ctrng_values)
    seed = hashlib.sha256(raw).digest()

    ctr = 0
    while True:
        block = hashlib.sha256(seed + ctr.to_bytes(4, "big")).digest()
        for b in block:
            if b < 252:
                return {
                    "seed_hex": seed.hex(),
                    "die": (b % 6) + 1,
                }
        ctr += 1


# ---------------------------------------------------------------------------
# Commitment integrity
# ---------------------------------------------------------------------------
def canonical(commitment_without_hash):
    """Stable serialization used for the commitment hash."""
    return json.dumps(commitment_without_hash, indent=2, sort_keys=True).encode()


def commitment_hash(commitment_without_hash):
    return hashlib.sha256(canonical(commitment_without_hash)).hexdigest()


# ---------------------------------------------------------------------------
# Sub-commands
# ---------------------------------------------------------------------------
def cmd_commit(args):
    delay_seconds = int(args.minutes * 60)

    print("Fetching current beacon state...")
    latest = fetch_latest_block()
    current_seq = latest["data"]["sequence"]
    current_ts = latest["data"]["timestamp"]

    blocks_to_wait = max(1, delay_seconds // BEACON_INTERVAL_SEC)
    target_seq = current_seq + blocks_to_wait
    target_eta_unix = current_ts + blocks_to_wait * BEACON_INTERVAL_SEC
    target_eta_iso = datetime.fromtimestamp(target_eta_unix, tz=timezone.utc).isoformat()

    commitment = {
        "scheme_version": "1.0",
        "beacon": {
            "name": "SpaceComputer cTRNG (cosmic radiation)",
            "ipns": BEACON_IPNS,
            "url": BEACON_URL,
            "block_interval_sec": BEACON_INTERVAL_SEC,
        },
        "committed_at": {
            "current_sequence": current_seq,
            "current_timestamp_unix": current_ts,
            "current_timestamp_iso": datetime.fromtimestamp(current_ts, tz=timezone.utc).isoformat(),
            "wall_clock_unix": int(time.time()),
        },
        "target": {
            "sequence": target_seq,
            "estimated_timestamp_unix": target_eta_unix,
            "estimated_timestamp_iso": target_eta_iso,
            "delay_minutes": args.minutes,
        },
        "algorithm": {
            "step_1": "raw = bytes(ctrng[0]) || bytes(ctrng[1]) || bytes(ctrng[2])",
            "step_2": "seed = SHA256(raw)  (32 bytes)",
            "step_3": "stream = SHA256(seed||uint32_be(0)) || SHA256(seed||uint32_be(1)) || ...",
            "step_4": "draw bytes from stream; accept b iff b < 252; roll = (b % 6) + 1",
            "step_5": "first accepted byte -> die ; result (1..6) = die",
        },
        "output": "result (1..6) — uniform on {1,2,3,4,5,6}",
    }

    h = commitment_hash(commitment)
    commitment["commitment_sha256"] = h
    COMMIT_FILE.write_text(json.dumps(commitment, indent=2, sort_keys=True))

    bar = "=" * 72
    print()
    print(bar)
    print("COMMITMENT CREATED")
    print(bar)
    print(f"Current beacon sequence : {current_seq}")
    print(f"Target  beacon sequence : {target_seq}")
    print(f"Estimated reveal time   : {target_eta_iso}")
    print(f"Commitment SHA-256      : {h}")
    print()
    print("PUBLISH THIS HASH NOW so anyone can later verify you didn't cheat:")
    print(f"  {h}")
    print()
    print("Suggestions where to publish:")
    print("  • Tweet/X post with the hash")
    print("  • Bitcoin OP_RETURN or Ethereum tx data field")
    print("  • Public Git commit message")
    print("  • OpenTimestamps (https://opentimestamps.org)")
    print()
    print(f"Commitment file saved   : {COMMIT_FILE.resolve()}")
    print(f"In ~{args.minutes} minute(s) run:  python {sys.argv[0]} reveal")


def cmd_reveal(args):
    if not COMMIT_FILE.exists():
        sys.exit(f"No commitment file found at {COMMIT_FILE}. Run `commit` first.")

    commitment = json.loads(COMMIT_FILE.read_text())
    target_seq = commitment["target"]["sequence"]
    expected_hash = commitment["commitment_sha256"]

    # Re-verify integrity of the local commitment file.
    c2 = {k: v for k, v in commitment.items() if k != "commitment_sha256"}
    if commitment_hash(c2) != expected_hash:
        sys.exit(
            "Commitment file integrity check FAILED — file has been altered "
            "since it was committed."
        )

    print(f"Commitment hash : {expected_hash}")
    print(f"Target sequence : {target_seq}")
    print()
    print(f"Fetching beacon block...")
    block = fetch_block_by_sequence(target_seq)

    ctrng = block["data"]["ctrng"]
    seq = block["data"]["sequence"]
    ts = block["data"]["timestamp"]

    result = derive_die_roll(ctrng)

    bar = "=" * 72
    print()
    print(bar)
    print("REVEAL")
    print(bar)
    print(f"Beacon sequence   : {seq}")
    print(f"Beacon timestamp  : {datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()}")
    print(f"cTRNG values      :")
    for i, v in enumerate(ctrng):
        print(f"  [{i}] {v}")
    print(f"Derived seed      : {result['seed_hex']}")
    print()
    print(f"  Result (1..6)   : {result['die']}")
    print()
    print("Anyone can verify this result by:")
    print(f"  1. reading the public commitment hash {expected_hash[:16]}...")
    print(f"  2. fetching beacon block {seq} from IPFS")
    print( "  3. running this script with the same commitment file")

    # Persist the reveal alongside the commitment so it stays auditable.
    commitment["reveal"] = {
        "beacon_sequence": seq,
        "beacon_timestamp_unix": ts,
        "ctrng": ctrng,
        "seed_hex": result["seed_hex"],
        "die": result["die"],
        "result_1_6": result["die"],
        "revealed_wall_clock_unix": int(time.time()),
    }
    COMMIT_FILE.write_text(json.dumps(commitment, indent=2, sort_keys=True))
    print(f"\nUpdated commitment file: {COMMIT_FILE.resolve()}")


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Commit-reveal dice roller backed by SpaceComputer cTRNG."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_commit = sub.add_parser("commit", help="Create a commitment for a future draw.")
    p_commit.add_argument(
        "minutes",
        type=float,
        help="How long until reveal, in minutes (e.g. 5 or 60).",
    )

    sub.add_parser("reveal", help="Execute the previously committed draw.")

    args = parser.parse_args()
    if args.cmd == "commit":
        cmd_commit(args)
    elif args.cmd == "reveal":
        cmd_reveal(args)


if __name__ == "__main__":
    main()
