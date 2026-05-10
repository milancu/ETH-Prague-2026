import { useMemo } from "react"
import { useReadContracts } from "wagmi"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import {
  TABCOIN_ADDRESS,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  FACTORY_ABI,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"

// Returns a map of outcomeLabel → implied price (0–100) derived from the live order book.
// Labels match getOutcomeSlots: "YES"/"NO", "Higher"/"Lower", or multi outcome labels.
// Returns empty object while loading or when no orders exist yet.
export function useMarketPrices(market: Market | undefined): Record<string, number> {
  const slots = market ? getOutcomeSlots(market) : []

  const { data: orders = [] } = useOrders(
    market ? { marketId: market.marketId } : undefined,
  )

  const { data: wrapperData } = useReadContracts({
    contracts: market
      ? slots.map(({ indexSet }) => ({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getWrapper" as const,
          args: [TABCOIN_ADDRESS, market.conditionId as `0x${string}`, indexSet] as const,
        }))
      : [],
    query: { enabled: !!market && slots.length > 0 },
  })

  return useMemo(() => {
    if (!wrapperData || orders.length === 0) return {}

    const TAB = TABCOIN_ADDRESS.toLowerCase()

    // Collect bid/ask prices per wrapper address (TAB per outcome token, as %)
    const byWrapper: Record<string, { bids: number[]; asks: number[] }> = {}

    for (const order of orders) {
      const isBuy = order.makerToken.toLowerCase() === TAB
      const outcomeAddr = (isBuy ? order.takerToken : order.makerToken).toLowerCase()
      const makerAmt = Number(BigInt(order.makerAmount)) / 1e18
      const takerAmt = Number(BigInt(order.takerAmount)) / 1e18
      if (!makerAmt || !takerAmt) continue

      // Price = TAB side / outcome side  →  convert to 0–100 %
      const pct = Math.round((isBuy ? makerAmt / takerAmt : takerAmt / makerAmt) * 100)

      if (!byWrapper[outcomeAddr]) byWrapper[outcomeAddr] = { bids: [], asks: [] }
      if (isBuy) byWrapper[outcomeAddr].bids.push(pct)
      else byWrapper[outcomeAddr].asks.push(pct)
    }

    const result: Record<string, number> = {}

    slots.forEach(({ label }, i) => {
      const wr = wrapperData[i]
      if (!wr || wr.status !== "success") return
      const addr = (wr.result as string).toLowerCase()
      if (!addr || BigInt(addr) === 0n) return

      const prices = byWrapper[addr]
      if (!prices) return

      const bestBid = prices.bids.length ? Math.max(...prices.bids) : null
      const bestAsk = prices.asks.length ? Math.min(...prices.asks) : null

      let mid: number
      if (bestBid !== null && bestAsk !== null) mid = Math.round((bestBid + bestAsk) / 2)
      else if (bestBid !== null) mid = bestBid
      else if (bestAsk !== null) mid = bestAsk
      else return

      result[label] = Math.min(99, Math.max(1, mid))
    })

    return result
  }, [wrapperData, orders, slots])
}