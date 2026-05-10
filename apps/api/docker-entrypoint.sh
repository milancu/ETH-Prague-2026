#!/bin/sh
set -e

# Re-import the outbound x402 wallet into mcpc on every start so the key in
# /root/.mcpc stays in sync with the env var.  `mcpc x402 import` refuses to
# overwrite, so we remove the existing wallet first (no-op on first run).
if [ -n "$X402_OUT_WALLET_PK" ]; then
  echo "[entrypoint] syncing X402_OUT_WALLET_PK into mcpc"
  mcpc x402 remove >/dev/null 2>&1 || true
  mcpc x402 import "$X402_OUT_WALLET_PK" >/dev/null
  mcpc x402 info || true
else
  echo "[entrypoint] X402_OUT_WALLET_PK is empty — Apify x402 calls will fail"
fi

exec "$@"