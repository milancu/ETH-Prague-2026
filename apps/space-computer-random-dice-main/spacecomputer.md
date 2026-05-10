# docs/bounties/spacecomputer.md — SpaceComputer cTRNG integration (skeleton)

**Status:** placeholder. To be specified together before implementation.

---

## 1. Bounty summary (from Notion, for context)

- **Title:** *Create Secure Apps with Space-Powered Tech*
- **Prize pool:** $6,000 USD in stables, split across multiple winners (no fixed tiers).
- **Three tracks** (we may pursue any combination):
  1. **Space Fabric Hardware** — devices like USB Armory Mk II, Raspberry Pi.
  2. **Orbitport Gateway Extensions** — protocol/data filtering plugins.
  3. **Space-Powered Security APIs** — **cosmic true random number generator (cTRNG)** + Key Management Service (KMS).
- **Required:** clear, working integration with at least one track.
- **Mentors:** Filip Rezabek (`@elrondjr`), Amir Yahalom (`@am_ylm`), Pedro Sousa (`@zkpedro`).
- **Docs:** <https://docs.spacecomputer.io/>

Apify-style warning to expect: APIs experimental, test before demo day.

---

## 2. Why this fits our project

We're a prediction-market protocol. Markets need **verifiable randomness** for several legitimate use cases:

- Cosmic-lottery markets (outcome derived from a future random draw).
- Fair tie-breaking when CLOB orders match at the same price.
- Random sampling for post-resolution audit (which markets a human curator reviews).
- Future seed generation for VRF-style features.

cTRNG (cosmic true random number generator) is exactly the right primitive — randomness sourced from cosmic ray detectors in orbit, signed and verifiable, *demonstrably not generatable on Earth*. That's a story judges remember.

We focus on Track 3 (Security APIs). Hardware (Track 1) and Orbitport (Track 2) require physical setup that doesn't fit a software-only hackathon team.

---

## 3. Three integration shapes — TBD which we pick

### 3.A "Cosmic Lottery" market type

A new prediction market variant where the outcome is **a future cTRNG draw**. Users bet on the value (binary above/below threshold, or buckets). At market resolution, we pull cTRNG, verify signature on-chain, settle.

**Pros:** novel market type, cTRNG visible in the product flow, demos well ("the prediction market that lottery couldn't fake").
**Cons:** requires new market type in `PredictionMarketV2` (contract change).

### 3.B Verifiable randomness oracle (`RandomnessProvider` smart contract)

A reusable on-chain primitive any market can call to get an attested cTRNG value, with signature verification. Used internally for:
- Random tie-breaking on CLOB matches at equal price.
- Curator-of-the-week selection from staked curators.
- Random sampling of markets to audit.

**Pros:** shared primitive — multiple existing flows benefit. Cleaner architectural fit.
**Cons:** less visible in demo (background plumbing).

### 3.C Random sampling for fairness/audit

cTRNG-driven random selection of a subset of markets for post-resolution review by curators. Cheap to integrate, statistically meaningful, hard to game.

**Pros:** smallest scope, low integration risk.
**Cons:** weakest story for judges (sounds like compliance not product).

---

## 4. Decision points to resolve before coding

- [ ] Which track(s) do we pursue — A, B, or A+B (skip C as too thin)?
- [ ] Does cTRNG return data fast enough for synchronous resolution flow, or do we have to model it as a delayed reveal?
- [ ] What does cTRNG payload look like (signature scheme, attestation format)? — read <https://docs.spacecomputer.io/> first.
- [ ] On-chain verification of cTRNG signature — what's the gas cost? Do we want full on-chain verify or off-chain attest with optimistic dispute window?
- [ ] Do we need API keys / accounts to call cTRNG, or is it open like x402 Apify? — confirm with mentor.
- [ ] Network: do they support Base Sepolia / Base mainnet, or is this on a different chain we'd have to bridge?

---

## 5. Bounty alignment thoughts (placeholder)

Judging criteria from Notion:
1. **Use case quality** — does it solve a real or genuinely interesting problem?
2. **Technical integration depth** — meaningful use, not "wrap an API call in UI".
3. **Creativity** — unexpected combinations, novel ideas.
4. **Working demo** — runs end-to-end.

Our angle (TBD which we sharpen):
- *"Prediction markets need entropy that markets themselves can't manipulate. Earth-based VRFs assume a trust model SpaceComputer's cosmic ray entropy doesn't need."*

---

## 6. Mentor workflow

Same playbook as Apify mentor (Jakub):
- Day 1 booth visit: ask
  - which track they recommend for a software team
  - PPE-style gotchas in their API (unstable schemas, rate limits)
  - whether on-chain signature verification is in their hot path or off-chain attested
- Bring the equivalent of `/tmp/x402_apify_debug.log` as evidence of integration depth before final demo.

---

## 7. File map (placeholder)

```
apps/contracts/contracts/randomness/
└── (CosmicRandomness.sol or RandomnessProvider.sol — TBD which shape)

apps/api/src/api/
├── routes/
│   └── (randomness endpoints if backend-mediated)
└── lib/
    └── ctrng_client.py    # client to docs.spacecomputer.io API

apps/api/src/api/llm/tools/
└── (optional: Kowalsky tools that consume cTRNG, e.g. "cosmic flip")
```

---

## 8. Open questions

1. Which integration shape (§3) do we commit to?
2. Does cTRNG fit naturally into the existing `PredictionMarketV2` market lifecycle, or do we need a new market type contract?
3. Stacking — does this combine cleanly with our ENS work (e.g. cosmic lottery market gets `cosmic-flip-2026-12-31.kowalsky.eth` ENS subname)? **Probably yes — same registrar.**
4. Is there a mainnet vs testnet asymmetry like we hit with x402 (inbound Sepolia, outbound mainnet)?

---

*This document is a stub. Specify before writing any contract or backend code.*
