import { useAccount } from "wagmi"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { OrderRow } from "@/features/orders/components/order-row"

export function MyOrders() {
  const { address, isConnected } = useAccount()
  const { data: orders = [], isLoading } = useOrders(
    address ? { maker: address } : undefined,
  )

  if (!isConnected) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Connect your wallet to see your orders.
      </p>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted" />
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
        <span className="flex-1 text-[10px] uppercase tracking-widest text-muted-foreground">Note</span>
        <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Price</span>
        <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground">Amount</span>
        <span className="hidden w-20 shrink-0 text-right text-[10px] uppercase tracking-widest text-muted-foreground sm:block">Expiry</span>
        <div className="w-[22px] shrink-0" />
      </div>

      {orders.map((order) => (
        <OrderRow key={order.id} order={order} isOwn />
      ))}
    </div>
  )
}