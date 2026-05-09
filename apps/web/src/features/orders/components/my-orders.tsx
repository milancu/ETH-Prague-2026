import { useMemo } from "react"
import { useAccount, useReadContracts } from "wagmi"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { OrderRow } from "@/features/orders/components/order-row"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import {
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"

const TAB = TABCOIN_ADDRESS.toLowerCase()

export function MyOrders() {
  const { address, isConnected } = useAccount()
  const { data: orders = [], isLoading: ordersLoading } = useOrders(
    address ? { maker: address } : undefined,
  )
  const { data: marketPage } = useMarkets()

  const marketById = useMemo((): Map<number, Market> => {
    const map = new Map<number, Market>()
    for (const m of marketPage?.markets ?? []) {
      map.set(m.marketId, m)
    }
    return map
  }, [marketPage])

  // Build a list of (conditionId, indexSet, label) for every slot in every market
  // that appears in the user's orders, so we can map wrapper address → outcome label.
  const wrapperContracts = useMemo(() => {
    const entries: {
      label: string
      conditionId: `0x${string}`
      indexSet: bigint
    }[] = []
    const seen = new Set<number>()
    for (const order of orders) {
      if (order.marketId == null || seen.has(order.marketId)) continue
      seen.add(order.marketId)
      const market = marketById.get(order.marketId)
      if (!market) continue
      for (const slot of getOutcomeSlots(market)) {
        entries.push({
          label: slot.label,
          conditionId: market.conditionId as `0x${string}`,
          indexSet: slot.indexSet,
        })
      }
    }
    return entries
  }, [orders, marketById])

  const { data: wrapperResults } = useReadContracts({
    contracts: wrapperContracts.map(({ conditionId, indexSet }) => ({
      address: POSITION_WRAPPER_FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getWrapper" as const,
      args: [TABCOIN_ADDRESS, conditionId, indexSet] as const,
    })),
    query: { enabled: wrapperContracts.length > 0, staleTime: 30_000 },
  })

  // wrapperAddress.toLowerCase() → outcome label (e.g. "YES", "NO")
  const wrapperLabelMap = useMemo((): Map<string, string> => {
    const map = new Map<string, string>()
    if (!wrapperResults) return map
    for (let i = 0; i < wrapperContracts.length; i++) {
      const raw = wrapperResults[i]?.result as `0x${string}` | undefined
      if (raw && BigInt(raw) !== 0n) {
        map.set(raw.toLowerCase(), wrapperContracts[i].label)
      }
    }
    return map
  }, [wrapperResults, wrapperContracts])

  if (!isConnected) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Connect your wallet to see your orders.
      </p>
    )
  }

  if (ordersLoading) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted" />
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No open orders.
      </p>
    )
  }

  return (
    <div className="flex flex-col border border-border">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-muted/30">
        <span className="w-10 shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">Side</span>
        <span className="flex-1 text-[10px] uppercase tracking-widest text-muted-foreground">Market</span>
        <span className="hidden w-20 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground sm:block">Price</span>
        <span className="hidden w-16 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground sm:block">Amount</span>
        <span className="w-20 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Total</span>
        <span className="hidden w-24 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground lg:block">Expiry</span>
        <div className="w-[22px] shrink-0" />
      </div>

      {orders.map((order) => {
        const outcomeToken = order.makerToken.toLowerCase() === TAB
          ? order.takerToken.toLowerCase()
          : order.makerToken.toLowerCase()
        return (
          <OrderRow
            key={order.id}
            order={order}
            market={order.marketId != null ? marketById.get(order.marketId) : undefined}
            isOwn
            outcomeLabel={wrapperLabelMap.get(outcomeToken)}
          />
        )
      })}
    </div>
  )
}