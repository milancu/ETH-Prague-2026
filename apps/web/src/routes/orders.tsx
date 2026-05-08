import { createFileRoute } from "@tanstack/react-router"
import { MyOrders } from "@/features/orders/components/my-orders"

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
})

function OrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My Orders</h1>
        <p className="text-sm text-muted-foreground">Open limit orders from your wallet.</p>
      </div>
      <MyOrders />
    </div>
  )
}