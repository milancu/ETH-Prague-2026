import { useMemo } from "react"
import { useAccount } from "wagmi"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { OrderRow } from "@/features/orders/components/order-row"
import type { Market } from "@/features/market/types"

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

      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          market={order.marketId != null ? marketById.get(order.marketId) : undefined}
          isOwn
        />
      ))}
    </div>
  )
}