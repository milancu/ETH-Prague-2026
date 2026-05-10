"""Reproduce the bridge registerMarket failure with a clean exception print.

Tries to call MarketSubnameRegistrar.registerMarket("test-debug-<unix>", 99999)
using exactly the same code path the bridge uses (same RPC, same gas params,
same signing). Prints the raw exception class + message + chain reason if any.

Run inside the api container:
    docker compose exec api uv run python /tmp/repro_register_failure.py
"""

from __future__ import annotations

import os
import sys
import time
import traceback

sys.path.insert(0, "/app/src")


def main() -> int:
    # Avoid touching ENSBridge.__init__ side-effects; build a minimal mirror.
    from web3 import Web3
    from eth_account import Account
    import json
    from pathlib import Path

    rpc = os.getenv("RPC_URL_11155111")
    pk = os.getenv("ENS_BRIDGE_SIGNER_PK")
    registrar_addr = os.getenv("ENS_REGISTRAR_ADDRESS")
    if not (rpc and pk and registrar_addr):
        print("MISSING ENV"); return 1

    w3 = Web3(Web3.HTTPProvider(rpc))
    acct = Account.from_key(pk)
    print(f"signer:        {acct.address}")
    print(f"chainId:       {w3.eth.chain_id}")
    print(f"latest block:  {w3.eth.block_number}")
    print(f"balance ETH:   {w3.from_wei(w3.eth.get_balance(acct.address), 'ether')}")
    print(f"nonce latest:  {w3.eth.get_transaction_count(acct.address, 'latest')}")
    print(f"nonce pending: {w3.eth.get_transaction_count(acct.address, 'pending')}")
    print(f"gasPrice:      {w3.from_wei(w3.eth.gas_price, 'gwei')} gwei")

    abi_path = Path("/app/src/api/abi/ens/MarketSubnameRegistrar.json")
    abi = json.loads(abi_path.read_text())
    abi = abi if isinstance(abi, list) else abi["abi"]
    registrar = w3.eth.contract(
        address=Web3.to_checksum_address(registrar_addr), abi=abi
    )

    slug = f"test-repro-{int(time.time())}"
    market_id = 999999
    print(f"\nattempting registerMarket(slug={slug!r}, marketId={market_id})")

    fn = registrar.functions.registerMarket(slug, market_id)

    # 1) Plain eth_call simulation (read-only, no gas spent) — proves logic path
    print("\n[1] eth_call simulation:")
    try:
        result = fn.call({"from": acct.address})
        print(f"    ok, returned node = 0x{result.hex()}")
    except Exception as e:
        print(f"    REVERT: {type(e).__name__}: {e}")
        traceback.print_exc()
        return 2

    # 2) estimateGas — common failure spot for tx prep
    print("\n[2] estimateGas:")
    try:
        gas_est = fn.estimate_gas({"from": acct.address})
        print(f"    ok, gas estimate = {gas_est}")
    except Exception as e:
        print(f"    FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        return 3

    # 3) Build + sign + send (this is what bridge does)
    print("\n[3] build + sign + send (mirror of bridge _send_tx):")
    try:
        tx = fn.build_transaction({
            "from":               acct.address,
            "nonce":              w3.eth.get_transaction_count(acct.address),
            "gas":                500_000,
            "maxFeePerGas":       w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
            "chainId":            11155111,
        })
        print(f"    built tx: {tx}")
    except Exception as e:
        print(f"    BUILD FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        return 4

    try:
        signed = w3.eth.account.sign_transaction(tx, acct.key)
        print(f"    signed ok")
    except Exception as e:
        print(f"    SIGN FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        return 5

    try:
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        print(f"    SENT: 0x{h.hex()}")
    except Exception as e:
        print(f"    SEND FAIL: {type(e).__name__}: {e!r}")
        # Some web3 errors carry .args[0] dict with 'code'/'message'
        if e.args:
            print(f"    args[0]: {e.args[0]!r}")
        traceback.print_exc()
        return 6

    print(f"\n    waiting for receipt (timeout 60s)…")
    try:
        r = w3.eth.wait_for_transaction_receipt(h, timeout=60)
        print(f"    receipt: status={r['status']} block={r['blockNumber']} gasUsed={r['gasUsed']}")
    except Exception as e:
        print(f"    RECEIPT FAIL: {type(e).__name__}: {e}")
        traceback.print_exc()
        return 7

    return 0


if __name__ == "__main__":
    sys.exit(main())
