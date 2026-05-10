"""ENS bridge diagnostic — run inside the api container.

Usage:
    docker compose exec api python /app/scripts/diag_ens_bridge.py

Reports: DB checkpoint, RPC connectivity, on-chain MarketCreated event count
(via the same bundled ABI the bridge uses), and registrar-side state for
each market in the local DB.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

# Make `api.*` importable when run from /app/scripts/
sys.path.insert(0, "/app/src")

from api.indexer.ens_bridge import _CHECKPOINT_NAME, _DEFAULT_START_BLOCK


def _section(label: str) -> None:
    print(f"\n{'=' * 8} {label} {'=' * 8}")


def main() -> int:
    db_path = "/app/data/api.db"

    _section("ENV")
    for key in [
        "ENS_BRIDGE_ENABLED",
        "PMV2_ADDRESS_84532",
        "ENS_REGISTRAR_ADDRESS",
        "ENS_RESOLVER_ADDRESS",
        "RPC_URL_84532",
        "RPC_URL_11155111",
    ]:
        v = os.getenv(key, "(unset)")
        if "PK" in key or "KEY" in key:
            v = v[:6] + "…" if v != "(unset)" else v
        print(f"  {key} = {v}")

    _section("DB checkpoint")
    if not Path(db_path).exists():
        print(f"  DB not found at {db_path}")
        return 1
    conn = sqlite3.connect(db_path)
    rows = list(conn.execute("SELECT name, block_number, updated_at FROM indexer_checkpoints"))
    if not rows:
        print(f"  no checkpoint yet (will start from BRIDGE_START_BLOCK_84532 = {_DEFAULT_START_BLOCK})")
    else:
        for name, block, ts in rows:
            print(f"  {name}: block={block} updated={ts}")
            if name == _CHECKPOINT_NAME:
                print(f"    advanced from default by: {block - _DEFAULT_START_BLOCK + 1} blocks")

    _section("Local DB markets")
    db_markets = list(conn.execute(
        "SELECT market_id, title, chain_id, tx_hash FROM markets WHERE chain_id=84532 ORDER BY market_id"
    ))
    print(f"  count(chain_id=84532): {len(db_markets)}")
    for mid, title, _, tx in db_markets[:5]:
        print(f"    #{mid}: tx={tx} title={title!r}")
    if len(db_markets) > 5:
        print(f"    ... and {len(db_markets) - 5} more")

    _section("RPC connectivity")
    from web3 import Web3
    rpc = os.getenv("RPC_URL_84532", "https://sepolia.base.org")
    w3 = Web3(Web3.HTTPProvider(rpc))
    print(f"  rpc: {rpc[:60]}{'...' if len(rpc) > 60 else ''}")
    print(f"  is_connected: {w3.is_connected()}")
    current = w3.eth.block_number
    print(f"  current block: {current}")

    _section("PMv2 on-chain state")
    import json
    abi_path = Path("/app/src/api/abi/PredictionMarketV2.json")
    abi_data = json.loads(abi_path.read_text())
    abi_list = abi_data if isinstance(abi_data, list) else abi_data["abi"]
    pmv2_addr = os.getenv("PMV2_ADDRESS_84532")
    pmv2 = w3.eth.contract(address=Web3.to_checksum_address(pmv2_addr), abi=abi_list)

    # Does the contract have any markets at all?
    fn_names = [f["name"] for f in abi_list if f.get("type") == "function"]
    if "marketCount" in fn_names:
        try:
            count = pmv2.functions.marketCount().call()
            print(f"  marketCount(): {count}")
        except Exception as exc:
            print(f"  marketCount() ERROR: {exc}")
    elif "nextMarketId" in fn_names:
        try:
            nmi = pmv2.functions.nextMarketId().call()
            print(f"  nextMarketId(): {nmi}")
        except Exception as exc:
            print(f"  nextMarketId() ERROR: {exc}")
    else:
        print(f"  no marketCount/nextMarketId in ABI; available view fns: {[f for f in fn_names if 'market' in f.lower() or 'count' in f.lower()][:10]}")

    # Verify the address actually has contract code (not EOA / wrong addr)
    code_size = len(w3.eth.get_code(Web3.to_checksum_address(pmv2_addr)))
    print(f"  contract code size at {pmv2_addr}: {code_size} bytes")

    # Try fetching the latest known DB market by ID — does it exist on chain?
    if db_markets:
        latest_mid, _, _, latest_tx = db_markets[-1]
        try:
            m = pmv2.functions.getMarket(latest_mid).call()
            print(f"  getMarket({latest_mid}): EXISTS on chain")
            print(f"    creator={m[0]}")
            print(f"    name={m[6]!r}")
        except Exception as exc:
            print(f"  getMarket({latest_mid}): NOT ON CHAIN at this address ({exc})")
        # Did the saved tx_hash actually call this contract and emit any log?
        try:
            r = w3.eth.get_transaction_receipt(latest_tx)
            print(f"  tx {latest_tx[:12]}... receipt:")
            print(f"    to={r['to']} status={r['status']} logs={len(r['logs'])}")
            for lg in r["logs"][:5]:
                print(f"    log addr={lg['address']} topic0={lg['topics'][0].hex() if lg['topics'] else '(none)'}")
        except Exception as exc:
            print(f"  tx receipt for {latest_tx} ERROR: {exc}")

    _section("On-chain MarketCreated events (bundled ABI)")
    # Verify the event topic hash the bridge will use
    mc_event = pmv2.events.MarketCreated()
    topic_hash = mc_event.topic
    print(f"  event topic the bridge searches: {topic_hash}")

    start = _DEFAULT_START_BLOCK
    chunk = 5000
    total_events = []
    cursor = start
    while cursor <= current:
        end = min(cursor + chunk - 1, current)
        try:
            evs = mc_event.get_logs(from_block=cursor, to_block=end)
            print(f"  chunk {cursor}-{end}: {len(evs)} events")
            total_events.extend(evs)
        except Exception as exc:
            print(f"  chunk {cursor}-{end}: ERROR {exc}")
            break
        cursor = end + 1
    print(f"  TOTAL MarketCreated events on chain: {len(total_events)}")
    for ev in total_events[:5]:
        mid = ev["args"].get("marketId", "?")
        blk = ev["blockNumber"]
        print(f"    blk={blk} marketId={mid}")

    _section("Registrar state (Eth Sepolia)")
    eth_rpc = os.getenv("RPC_URL_11155111")
    eth_w3 = Web3(Web3.HTTPProvider(eth_rpc))
    registrar_addr = os.getenv("ENS_REGISTRAR_ADDRESS")
    registrar_abi = json.loads(
        Path("/app/src/api/abi/ens/MarketSubnameRegistrar.json").read_text()
    )
    registrar_abi = (
        registrar_abi if isinstance(registrar_abi, list) else registrar_abi["abi"]
    )
    registrar = eth_w3.eth.contract(
        address=Web3.to_checksum_address(registrar_addr), abi=registrar_abi
    )
    if total_events:
        sample_ids = sorted({e["args"]["marketId"] for e in total_events})[:10]
        print(f"  checking marketNodes for first {len(sample_ids)} on-chain market_ids:")
        for mid in sample_ids:
            node = registrar.functions.marketNodes(mid).call()
            registered = node != b"\x00" * 32
            print(f"    market #{mid}: registered={registered}")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
