"""One-shot script: update the CCIP-Read gateway URL on the MarketResolver contract.

Usage:
    ENS_BRIDGE_SIGNER_PK=0x... python scripts/update_gateway_url.py
"""

import os
import sys

from web3 import Web3

RESOLVER = "0xE5ddc8f9Ed573CfA1c23aaF97D6193FD2510EF93"
RPC = os.getenv("RPC_URL_11155111", "https://ethereum-sepolia-rpc.publicnode.com")
NEW_URL = "https://api.kowalski-market.com/v1/ens-gateway/{sender}/{data}.json"

def main() -> None:
    pk = os.getenv("ENS_BRIDGE_SIGNER_PK") or os.getenv("DEPLOYER_PRIVATE_KEY")
    if not pk:
        print("Set ENS_BRIDGE_SIGNER_PK or DEPLOYER_PRIVATE_KEY")
        sys.exit(1)

    w3 = Web3(Web3.HTTPProvider(RPC))
    account = w3.eth.account.from_key(pk)
    print(f"Signer: {account.address}")

    resolver = w3.eth.contract(
        address=Web3.to_checksum_address(RESOLVER),
        abi=[{
            "inputs": [{"name": "urls", "type": "string[]"}],
            "name": "setGatewayUrls",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function",
        }],
    )

    print(f"Setting gateway URL to: {NEW_URL}")
    tx = resolver.functions.setGatewayUrls([NEW_URL]).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 100_000,
        "maxFeePerGas": max(w3.eth.gas_price * 2, w3.to_wei(2, "gwei")),
        "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
        "chainId": 11155111,
    })
    signed = w3.eth.account.sign_transaction(tx, account.key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"TX sent: {tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    print(f"Confirmed in block {receipt['blockNumber']}, status={receipt['status']}")

if __name__ == "__main__":
    main()
