import { useCallback, useMemo } from "react"
import { useWalletClient } from "wagmi"
import { wrapFetchWithPayment } from "x402-fetch"
import type { IntelligenceRequest } from "./schema"

const BE_API_URL = import.meta.env.VITE_API_URL as string | undefined
// Hard cap on a single intelligence call: $1 USDC (6 decimals). The premium
// endpoint is $0.75, standard $0.50 — anything above $1 is malformed/abuse.
const MAX_PAYMENT_BASE_UNITS = 1_000_000n

interface UseIntelligencePaymentResult {
  /** Pay (sign EIP-3009 + retry) and return the parsed JSON body. */
  pay: (req: IntelligenceRequest) => Promise<unknown>
  /** Wallet not connected → the card disables its Pay button. */
  ready: boolean
}

export function useIntelligencePayment(): UseIntelligencePaymentResult {
  const { data: walletClient } = useWalletClient()

  // wrapFetchWithPayment closes over the wallet client. Re-bind only when the
  // wallet identity changes — it doesn't internally cache fetch state.
  const fetchWithPay = useMemo(() => {
    if (!walletClient) return null
    return wrapFetchWithPayment(
      // Bind globalThis so the wrapper still hits the real fetch when called
      // through a destructured reference.
      window.fetch.bind(window),
      walletClient,
      MAX_PAYMENT_BASE_UNITS,
    )
  }, [walletClient])

  const pay = useCallback(
    async (req: IntelligenceRequest): Promise<unknown> => {
      if (!fetchWithPay) throw new Error("Connect a wallet to pay")
      if (!BE_API_URL) throw new Error("VITE_API_URL is not configured")
      const url = `${BE_API_URL}${req.endpoint}`

      const res = await fetchWithPay(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.args),
      })

      if (!res.ok) {
        // x402-fetch only handles 402; everything else surfaces here. The
        // body is usually JSON ({detail, error}) but be defensive.
        const text = await res.text().catch(() => "")
        const reason = parseFailure(text) ?? `HTTP ${res.status}`
        throw new Error(reason)
      }
      return res.json()
    },
    [fetchWithPay],
  )

  return { pay, ready: !!walletClient }
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
