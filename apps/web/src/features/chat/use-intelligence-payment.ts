import { useCallback, useMemo } from "react"
import { useChainId, useSwitchChain, useWalletClient } from "wagmi"
import { wrapFetchWithPayment } from "@x402/fetch"
import { x402Client } from "@x402/core/client"
import { ExactEvmScheme } from "@x402/evm"
import type { IntelligenceRequest } from "./schema"

const BE_API_URL = import.meta.env.VITE_API_URL as string | undefined
// Backend paywall lives on Base Sepolia (CAIP-2 eip155:84532). USDC pricing
// is $0.50 standard / $0.75 premium.
const NETWORK = "eip155:84532" as const
const PAYMENT_CHAIN_ID = 84532
// Toggle verbose payment logging by setting `localStorage.x402_debug = "1"`
// in the browser. Off by default so production users don't see noise.
const DEBUG =
  typeof window !== "undefined" &&
  window.localStorage.getItem("x402_debug") === "1"

const log = (...args: unknown[]): void => {
  if (DEBUG) console.log("[x402]", ...args)
}

interface UseIntelligencePaymentResult {
  /** Pay (sign EIP-3009 + retry) and return the parsed JSON body. */
  pay: (req: IntelligenceRequest) => Promise<unknown>
  /** Wallet not connected → the card disables its Pay button. */
  ready: boolean
}

/** x402 puts settlement details (success or failure) in base64-encoded JSON
 *  headers. Pull out a human-readable reason if one is present. */
function decodeReasonFromHeader(header: string | null): string | null {
  if (!header) return null
  try {
    const decoded = atob(header)
    log("decoded header", decoded)
    const parsed = JSON.parse(decoded) as {
      error?: unknown
      errorReason?: unknown
      reason?: unknown
      message?: unknown
    }
    const v =
      parsed.error ?? parsed.errorReason ?? parsed.reason ?? parsed.message
    if (typeof v === "string" && v) return v
  } catch {
    /* not base64 / not JSON */
  }
  return null
}

function parseFailure(body: string): string | null {
  if (!body) return null
  try {
    const j = JSON.parse(body) as { detail?: unknown; error?: unknown }
    const v = j.detail ?? j.error
    if (typeof v === "string") return v
  } catch {
    /* not JSON */
  }
  return body.length > 140 ? body.slice(0, 140) + "…" : body
}

export function useIntelligencePayment(): UseIntelligencePaymentResult {
  const { data: walletClient } = useWalletClient()
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  // Build the x402 v2 client and bind a paying-fetch wrapper. The python
  // backend uses x402 v2 (data in the `payment-required` base64 header,
  // not the v1 JSON body) — only @x402/fetch ≥2.x understands that format.
  const fetchWithPay = useMemo(() => {
    if (!walletClient) return null
    if (!walletClient.account) {
      log("walletClient has no account, skipping setup", walletClient)
      return null
    }
    // Build a ClientEvmSigner manually. `toClientEvmSigner` reads `signer.address`
    // directly which is undefined on viem's WalletClient (the address lives on
    // `walletClient.account.address`). We also bind walletClient.signTypedData so
    // it carries the account/chain context viem needs to dispatch the request.
    const account = walletClient.account
    const signer = {
      address: account.address,
      // viem's signTypedData requires `account`; the x402 scheme calls this
      // with just the typed-data parts (domain/types/message), so we forward
      // them and pin the account.
      signTypedData: (msg: Parameters<typeof walletClient.signTypedData>[0]) =>
        walletClient.signTypedData({ ...msg, account }),
    }
    log("signer prepared", {
      address: signer.address,
      chain: walletClient.chain?.id,
    })

    const client = new x402Client().register(
      NETWORK,
      // Cast: ClientEvmSigner is a structural interface; our object satisfies
      // the `address` + `signTypedData` requirements but not the optional
      // readContract/signTransaction. Extension flows that need those (EIP-2612
      // sponsoring) won't engage for plain USDC EIP-3009 transfers.
      new ExactEvmScheme(signer as never),
    )
    log("client registered", { network: NETWORK })

    const baseFetch = window.fetch.bind(window)
    const debugFetch: typeof fetch = async (input, init) => {
      log("fetch ->", typeof input === "string" ? input : input.toString(), {
        method: init?.method,
        hasXPayment: !!(
          init?.headers && (init.headers as Record<string, string>)["X-PAYMENT"]
        ),
      })
      const r = await baseFetch(input, init)
      const allHeaders: Record<string, string> = {}
      r.headers.forEach((v, k) => {
        allHeaders[k] = v.length > 200 ? v.slice(0, 200) + "…" : v
      })
      log("fetch <-", r.status, r.statusText, { headers: allHeaders })
      return r
    }
    return wrapFetchWithPayment(DEBUG ? debugFetch : baseFetch, client)
  }, [walletClient])

  const pay = useCallback(
    async (req: IntelligenceRequest): Promise<unknown> => {
      if (!fetchWithPay) throw new Error("Connect a wallet to pay")
      if (!BE_API_URL) throw new Error("VITE_API_URL is not configured")

      // MetaMask refuses signTypedData when the wallet's active chain doesn't
      // match the typed-data domain.chainId. The x402 server pins chainId
      // 84532, so we must move the wallet to Base Sepolia first — the signature
      // itself is off-chain (no gas, no on-chain tx) but the chain has to align.
      if (currentChainId !== PAYMENT_CHAIN_ID) {
        log("switching chain", { from: currentChainId, to: PAYMENT_CHAIN_ID })
        await switchChainAsync({ chainId: PAYMENT_CHAIN_ID })
      }

      const url = `${BE_API_URL}${req.endpoint}`
      log("pay() called", { url, args: req.args, price_usd: req.price_usd })
      try {
        const res = await fetchWithPay(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req.args),
        })
        log("pay() response", { status: res.status, ok: res.ok })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          // Settlement failure → empty `{}` body, real reason is in the
          // `payment-required` (b64) or `x-payment-response` (b64) header.
          const headerReason =
            decodeReasonFromHeader(res.headers.get("payment-required")) ??
            decodeReasonFromHeader(res.headers.get("x-payment-response"))
          const reason =
            headerReason ?? parseFailure(text) ?? `HTTP ${res.status}`
          log("pay() not-ok", { status: res.status, body: text, headerReason })
          throw new Error(reason)
        }
        return res.json()
      } catch (err) {
        log("pay() threw", err)
        throw err
      }
    },
    [fetchWithPay, currentChainId, switchChainAsync],
  )

  return { pay, ready: !!walletClient }
}
