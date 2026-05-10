# ENS ↔ x402 cosmetic link — task spec

**Date:** 2026-05-10
**Status:** approved, ready for implementation
**Branch:** `api/ens-x402-cosmetic-link`
**Estimated effort:** 1 hour total

---

## Goal

Make our existing ENS namespace look like a discoverable pointer to our
x402-paid intelligence endpoints, without building any actual on-chain
CCIP-Read plumbing.

Two visible artefacts:

1. **API exposes `ens_name` (already there) + new `ens_analysis_name`**
   on every market response.
2. **ENS bridge writes `api` / `api-input` / `price` text records** onto
   each market subname so a client doing `ens.text("…", "api")` finds
   our intelligence endpoint.

Frontend renders both names as click-to-copy in the market detail UI
(implemented separately by frontend team — out of scope here).

---

## Non-goals

- No CCIP-Read resolver smart contract.
- No off-chain gateway.
- No x402-during-ENS-resolution flow.
- No new subname registration for the analysis variant — it is a virtual
  string convention returned by the API only. (See "Why virtual" below.)

---

## Why virtual `analysis-<slug>` (not registered on-chain)

Registering `analysis-<slug>.kowalski.eth` as a real ENS subname would
require:
- A second `registerMarket`-style call from the bridge per market, doubling
  Eth Sepolia gas spend.
- Either a contract change to `MarketSubnameRegistrar` or a separate registrar.
- Owner/permission decisions for the second namespace.

For the same demo value (a copy-pasteable string that points to the paid
endpoint), we make `analysis-<slug>` a pure API/UI convention. Anyone who
asks "where can I resolve `analysis-<slug>.kowalski.eth` on-chain?" gets
the honest answer: *this is a logical pointer; the corresponding on-chain
subname is `<slug>.kowalski.eth`, which has the api/price records
attached.* That is acceptable hackathon framing.

If the bounty conversation later demands a real on-chain subname, that's
an independent follow-up (1-2h with the existing registrar).

---

## Slug correctness fix (preq)

Current `slugify()` in `apps/api/src/api/lib/ens.py` strips Czech
diacritics rather than transliterating, producing slugs like
`jestli-esko-vyhraje-zpas-nad-vdy`. We add `unidecode` (already a common
dep) to transliterate first:

```python
from unidecode import unidecode

def slugify(name: str) -> str:
    """Convert a market title to a DNS-safe slug (max 40 chars)."""
    slug = unidecode(name).lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug[:40]  # leave room for "analysis-" prefix and ENS suffix
```

Length cap drops from 63 to 40 because:
- Single ENS label limit is 63 bytes total.
- We need room for `"analysis-" + slug` to fit under 63 chars.
  With slug ≤ 40, total ≤ 49. Safe.

---

## Files touched

| File | Change |
|---|---|
| `apps/api/pyproject.toml` | Add `unidecode>=1.3.8` to dependencies |
| `apps/api/src/api/lib/ens.py` | Use `unidecode`; cap slug at 40; add `ens_analysis_name_for()` helper |
| `apps/api/src/api/routes/markets.py` | Add `ens_analysis_name` computed field on `MarketRead` |
| `apps/api/src/api/indexer/ens_bridge.py` | Append `api`, `api-input`, `price` text records during `MarketCreated` handler |
| `apps/api/tests/test_ens_helpers.py` | New: tests for slugify diacritics + new helpers |
| `apps/api/tests/test_market_response_ens.py` | New: assert API responses include both ENS names |

---

## Task breakdown

### Task 1: Add `unidecode` dependency and fix slugify

```bash
cd apps/api && uv add unidecode
```

Edit `apps/api/src/api/lib/ens.py`:

```python
"""Shared ENS slug/name helpers."""

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
```

### Task 2: Tests for the ENS helpers

Create `apps/api/tests/test_ens_helpers.py`:

```python
"""Tests for slugify + ENS name helpers."""

from api.lib.ens import ens_analysis_name_for, ens_name_for, slugify


def test_slugify_handles_czech_diacritics() -> None:
    assert slugify("Jestli Česko vyhraje nad Švédy") == (
        "jestli-cesko-vyhraje-nad-svedy"
    )


def test_slugify_strips_punctuation() -> None:
    assert slugify("Bitcoin >$200,000 by Dec 31?") == "bitcoin-200000-by-dec-31"


def test_slugify_max_40_chars() -> None:
    long = "a" * 100
    assert len(slugify(long)) == 40


def test_slugify_returns_empty_for_only_diacritics() -> None:
    # All chars transliterate to nothing recognisable, fall back path:
    assert slugify("???!!!") == ""


def test_ens_name_for_uses_slug() -> None:
    assert (
        ens_name_for(16, "Česko vs Švédy") == "cesko-vs-svedy.kowalski.eth"
    )


def test_ens_name_for_falls_back_when_slug_empty() -> None:
    assert ens_name_for(7, "???") == "market-7.kowalski.eth"


def test_ens_analysis_name_for_prefixes_analysis() -> None:
    assert (
        ens_analysis_name_for(16, "Česko vs Švédy")
        == "analysis-cesko-vs-svedy.kowalski.eth"
    )


def test_ens_analysis_name_for_falls_back_when_slug_empty() -> None:
    assert ens_analysis_name_for(7, "???") == "analysis-market-7.kowalski.eth"
```

Run: `cd apps/api && uv run pytest tests/test_ens_helpers.py -v`. Expected: 8 PASS.

### Task 3: Expose `ens_analysis_name` in `MarketRead`

Edit `apps/api/src/api/routes/markets.py`. Replace the import:

```python
from api.lib.ens import ens_analysis_name_for, ens_name_for
```

Find the existing `ens_name` computed field (around line 143-146) and add a sibling:

```python
    @computed_field  # type: ignore[misc]
    @property
    def ens_name(self) -> str:
        return ens_name_for(self.market_id, self.title)

    @computed_field  # type: ignore[misc]
    @property
    def ens_analysis_name(self) -> str:
        return ens_analysis_name_for(self.market_id, self.title)
```

### Task 4: API response test

Create `apps/api/tests/test_market_response_ens.py`:

```python
"""Verify market responses include both ENS names."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from api.db.models import Market
from api.db.session import SessionLocal, engine


@pytest.fixture(autouse=True)
async def _schema():
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture
async def client():
    from api.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _seed(market_id: int, title: str) -> None:
    async with SessionLocal() as session:
        m = Market(
            market_id=market_id,
            condition_id=f"0x{'a' * 64}",
            tx_hash=f"0x{'b' * 64}",
            chain_id=84532,
            creator=f"0x{'c' * 40}",
            title=title,
            description="",
            rules="",
            category="Sport",
            outcome_type="binary",
            outcomes=[{"label": "No"}, {"label": "Yes"}],
            expires_at=datetime(2026, 5, 25, 23, 59, 59, tzinfo=UTC),
            resolution_time=datetime(2026, 5, 26, 23, 59, 59, tzinfo=UTC),
            status="pending",
            created_at=datetime(2026, 5, 10, 12, 0, 0, tzinfo=UTC),
        )
        session.add(m)
        await session.commit()


@pytest.mark.asyncio
async def test_market_get_includes_both_ens_names(client: AsyncClient) -> None:
    await _seed(42, "Jestli Česko vyhraje nad Švédy")
    resp = await client.get("/v1/markets/42")
    assert resp.status_code == 200
    body: dict[str, Any] = resp.json()
    assert body["ens_name"] == "jestli-cesko-vyhraje-nad-svedy.kowalski.eth"
    assert (
        body["ens_analysis_name"]
        == "analysis-jestli-cesko-vyhraje-nad-svedy.kowalski.eth"
    )


@pytest.mark.asyncio
async def test_market_list_includes_both_ens_names(client: AsyncClient) -> None:
    await _seed(7, "Bitcoin >200k")
    resp = await client.get("/v1/markets")
    assert resp.status_code == 200
    markets = resp.json()["markets"]
    assert len(markets) == 1
    assert markets[0]["ens_name"] == "bitcoin-200k.kowalski.eth"
    assert markets[0]["ens_analysis_name"] == "analysis-bitcoin-200k.kowalski.eth"
```

Run: `cd apps/api && uv run pytest tests/test_market_response_ens.py -v`. Expected: 2 PASS.

### Task 5: ENS bridge writes api/price/api-input text records

Edit `apps/api/src/api/indexer/ens_bridge.py`. In `_handle_market_created`,
extend the `texts` dict (currently lines 174-180) to include the three new
keys. Before the loop add a constant for the public API base:

```python
_PUBLIC_API_BASE = os.getenv(
    "PUBLIC_API_BASE_URL", "https://api.kowalski-market.com"
)
_INTELLIGENCE_PRICE_USDC_6 = "500000"  # $0.50 in USDC 6-decimal units
```

Inside `_handle_market_created`, replace the `texts` block with:

```python
            texts = {
                "marketId": str(market_id),
                "status": "ACTIVE",
                "outcome": "pending",
                "expiresAt": str(market[11]),
                "creator": market[0],
                "api": f"{_PUBLIC_API_BASE}/v1/intelligence/analyze",
                "api-input": json.dumps({"market_title": market[6]}),
                "price": _INTELLIGENCE_PRICE_USDC_6,
            }
```

(Note `market[6]` is the title; `market[11]` is `expiresAt`. These indices were
fixed earlier on `main`.)

No new test for the bridge — it requires Eth Sepolia connectivity. The
bridge runs gated by `ENS_BRIDGE_ENABLED=1`, so the smoke test is the
deployed instance writing the records on the next `MarketCreated` event.

### Task 6: Lint, full tests, push

```bash
cd apps/api && uv run ruff check src/ tests/
cd apps/api && uv run pytest tests/ -q -k "not test_health and not test_free_route"
cd /Users/jankudlacek/Coding/ETH-Prague-2026 && git push -u origin api/ens-x402-cosmetic-link
```

---

## Demo script

After deploy:

```bash
# 1. API returns both names
curl https://api.kowalski-market.com/v1/markets/16 | jq '{ens_name, ens_analysis_name}'

# 2. ENS records contain api/price pointers (after the bridge processes
#    a fresh MarketCreated)
cast call --rpc-url $ETH_SEPOLIA_RPC $ENS_RESOLVER \
  "text(bytes32,string)(string)" $NODE "api"
# expected: "https://api.kowalski-market.com/v1/intelligence/analyze"

cast call --rpc-url $ETH_SEPOLIA_RPC $ENS_RESOLVER \
  "text(bytes32,string)(string)" $NODE "price"
# expected: "500000"

# 3. Hit the resolved endpoint, observe x402 challenge
curl -i -X POST https://api.kowalski-market.com/v1/intelligence/analyze \
  -H 'Content-Type: application/json' \
  -d '{"market_title": "Jestli Česko vyhraje zápas nad Švédy"}'
# expected: HTTP/1.1 402 Payment Required, with PAYMENT-REQUIRED header
```

The story for judges: *the ENS subname is the on-chain record telling
agents where to pay for analysis. One name, one resolution, one payment.*

---

## Files NOT touched (and why)

- **MarketSubnameRegistrar.sol / MarketResolver.sol** — no contract change
  needed; existing `setTexts` covers the new keys.
- **Frontend** — separate task for frontend team. Backend exposes both
  names; UI rendering is theirs.
