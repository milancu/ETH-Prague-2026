import { TABCOIN_ADDRESS } from "@/lib/contracts"
import type { Order } from "@/features/orders/types"

const TAB = TABCOIN_ADDRESS.toLowerCase()

// Wei string → human-readable number (18 decimals)
export function formatTokenAmount(weiStr: string, decimals = 4): string {
  const n = BigInt(weiStr)
  const whole = n / 10n ** 18n
  const frac = n % 10n ** 18n
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "")
  return fracStr.length > 0 ? `${whole}.${fracStr}` : String(whole)
}

// "buy" = maker is offering TAB to get outcome tokens
// "sell" = maker is offering outcome tokens to get TAB
export function getOrderSide(order: Order): "buy" | "sell" {
  return order.makerToken.toLowerCase() === TAB ? "buy" : "sell"
}

// Price in TAB per 1 outcome token
export function getOrderPrice(order: Order): number {
  const makerAmt = Number(BigInt(order.makerAmount)) / 1e18
  const takerAmt = Number(BigInt(order.takerAmount)) / 1e18
  if (takerAmt === 0) return 0
  return getOrderSide(order) === "buy"
    ? makerAmt / takerAmt   // TAB offered / outcome tokens wanted
    : takerAmt / makerAmt   // TAB wanted / outcome tokens offered
}

// Amount of outcome tokens in this order
export function getOutcomeAmount(order: Order): string {
  return getOrderSide(order) === "buy"
    ? formatTokenAmount(order.takerAmount)
    : formatTokenAmount(order.makerAmount)
}

export function formatExpiry(expiry: number): string {
  if (expiry === 0) return "No expiry"
  const d = new Date(expiry * 1000)
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
}

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}