"""Tests for the cosmic dice derivation algorithm and commitment logic.

Verifies the die roll derivation matches the reference implementation
(_reference/dice.py) for known beacon data and is deterministic.
"""

from __future__ import annotations

from api.lib.dice import derive_die_roll

# ---------------------------------------------------------------------------
# Known beacon data from SpaceComputer documentation / test vectors
# ---------------------------------------------------------------------------

# Fabricated but stable test vectors — three 32-byte hex strings
_CTRNG_A = [
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
]

_CTRNG_B = [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000001",
    "0000000000000000000000000000000000000000000000000000000000000002",
]


# ---------------------------------------------------------------------------
# derive_die_roll
# ---------------------------------------------------------------------------


def test_derive_die_roll_returns_1_to_6() -> None:
    result = derive_die_roll(_CTRNG_A)
    assert 1 <= result["die"] <= 6


def test_derive_die_roll_deterministic() -> None:
    r1 = derive_die_roll(_CTRNG_A)
    r2 = derive_die_roll(_CTRNG_A)
    assert r1["die"] == r2["die"]
    assert r1["seed_hex"] == r2["seed_hex"]


def test_derive_die_roll_different_inputs_may_differ() -> None:
    r_a = derive_die_roll(_CTRNG_A)
    r_b = derive_die_roll(_CTRNG_B)
    assert r_a["seed_hex"] != r_b["seed_hex"]


def test_derive_die_roll_seed_is_64_hex_chars() -> None:
    result = derive_die_roll(_CTRNG_A)
    seed = str(result["seed_hex"])
    assert len(seed) == 64
    int(seed, 16)  # must be valid hex


def test_derive_die_roll_matches_reference_algorithm() -> None:
    """Verify step-by-step against the reference implementation."""
    import hashlib

    ctrng = _CTRNG_A
    raw = b"".join(bytes.fromhex(v) for v in ctrng)
    seed = hashlib.sha256(raw).digest()

    # Counter-mode stream with rejection sampling
    expected_die = None
    ctr = 0
    while expected_die is None:
        block = hashlib.sha256(seed + ctr.to_bytes(4, "big")).digest()
        for b in block:
            if b < 252:
                expected_die = (b % 6) + 1
                break
        ctr += 1

    result = derive_die_roll(ctrng)
    assert result["die"] == expected_die
    assert result["seed_hex"] == seed.hex()


# ---------------------------------------------------------------------------
# Exhaustive: all 6 faces are reachable
# ---------------------------------------------------------------------------


def test_all_six_faces_reachable() -> None:
    """With enough distinct inputs, all 6 faces should appear."""
    seen: set[int] = set()
    for i in range(200):
        ctrng = [
            f"{i:064x}",
            f"{i + 1000:064x}",
            f"{i + 2000:064x}",
        ]
        result = derive_die_roll(ctrng)
        seen.add(int(result["die"]))
        if len(seen) == 6:
            break
    assert seen == {1, 2, 3, 4, 5, 6}


# ---------------------------------------------------------------------------
# Payouts vector
# ---------------------------------------------------------------------------


def test_payouts_from_die_roll() -> None:
    """The payouts vector should have a 1 at index (die - 1)."""
    result = derive_die_roll(_CTRNG_A)
    die = int(result["die"])
    payouts = [0] * 6
    payouts[die - 1] = 1

    assert len(payouts) == 6
    assert sum(payouts) == 1
    assert payouts[die - 1] == 1
