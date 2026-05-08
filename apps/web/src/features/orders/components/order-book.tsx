import { useAccount } from "wagmi"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { OrderRow } from "@/features/orders/components/order-row"

interface OrderBookProps {
  marketId: number
}

export function OrderBook({ marketId }: OrderBookProps) {
  const { address } = useAccount()
  const { data: orders = [], isLoading } = useOrders({ marketId })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted" />
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No open orders for this market.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border">
        <span className="w-10 shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">Side</span>
        <span className="flex-1 text-[10px] uppercase tracking-widest text-muted-foreground">Note</span>
        <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Price</span>
        <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Amount</span>
        <span className="hidden w-20 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground sm:block">Expiry</span>
        <div className="w-[22px] shrink-0" />
      </div>

      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          isOwn={!!address && order.maker.toLowerCase() === address.toLowerCase()}
        />
      ))}
    </div>
  )
}