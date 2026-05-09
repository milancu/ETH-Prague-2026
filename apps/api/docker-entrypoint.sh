#!/bin/sh
set -e

# Import the outbound x402 wallet into mcpc so `mcpc x402 sign ...` works
# from inside lib/apify_x402.py.  mcpc stores the key under $HOME/.mcpc and
# overwriting on each start is idempotent — keeps the key in sync with .env.
if [ -n "$X402_OUT_WALLET_PK" ]; then
  echo "[entrypoint] importing X402_OUT_WALLET_PK into mcpc"
  mcpc x402 import "$X402_OUT_WALLET_PK" >/dev/null
  mcpc x402 info || true
else
  echo "[entrypoint] X402_OUT_WALLET_PK is empty — Apify x402 calls will fail"
fi

exec "$@"