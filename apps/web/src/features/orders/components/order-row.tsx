import { Link } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { Trash2, Zap } from "lucide-react"
import { toast } from "sonner"
import { useDeleteOrder } from "@/features/orders/hooks/use-delete-order"
import { useFillOrder } from "@/features/orders/hooks/use-fill-order"
import {
  getOrderSide,
  getOrderPrice,
  getOutcomeAmount,
  getTabTotal,
  formatExpiry,
  formatCreatedAt,
  truncateAddress,
} from "@/features/orders/lib/utils"
import type { Order } from "@/features/orders/types"
import type { Market, MarketCategory } from "@/features/market/types"

const CATEGORY_BADGE: Record<MarketCategory, string> = {
  Finance:  "bg-amber-500/10  text-amber-400",
  Politics: "bg-blue-500/10   text-blue-400",
  Sport:    "bg-emerald-500/10 text-emerald-400",
  Czech:    "bg-purple-500/10 text-purple-400",
  Weather:  "bg-cyan-500/10   text-cyan-400",
}

const STATUS_BADGE: Record<string, string> = {
  open:      "border-emerald-500/30 text-emerald-400",
  pending:   "border-amber-500/30   text-amber-400",
  resolved:  "border-border         text-muted-foreground",
  cancelled: "border-rose-500/30    text-rose-400",
}

interface OrderRowProps {
  order: Order
  market?: Market
  isOwn: boolean
}

export function OrderRow({ order, market, isOwn }: OrderRowProps) {
  const { mutate: deleteOrder, isPending: isCancelling } = useDeleteOrder()
  const { fillOrder, isPending: isFilling } = useFillOrder()
  const isPending = isCancelling || isFilling

  const side = getOrderSide(order)
  const price = getOrderPrice(order)
  const amount = getOutcomeAmount(order)
  const total = getTabTotal(order)

  function handleCancel() {
    deleteOrder(order, {
      onSuccess: () => toast.success("Order cancelled", { id: order.id }),
      onError: () => toast.error("Failed to cancel order", { id: order.id }),
    })
  }

  async function handleFill() {
    try {
      await fillOrder(order)
    } catch {
      // toast already shown by useFillOrder
    }
  }

  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0",
      "transition-colors duration-100",
      isPending && "opacity-40",
    )}>
      {/* Side badge */}
      <span className={cn(
        "shrink-0 w-10 text-center text-[10px] font-bold tracking-widest uppercase py-0.5",
        side === "buy"
          ? "bg-emerald-500/10 text-emerald-400"
          : "bg-rose-500/10 text-rose-400",
      )}>
        {side === "buy" ? "BUY" : "SELL"}
      </span>

      {/* Market info or fallback */}
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        {market ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <Link
                to="/markets/$marketId"
                params={{ marketId: market.id }}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-xs font-medium text-foreground hover:underline underline-offset-2"
              >
                {market.title}
              </Link>
              <span className={cn(
                "shrink-0 px-1 py-0.5 text-[9px] font-bold tracking-widest uppercase",
                CATEGORY_BADGE[market.category],
              )}>
                {market.category}
              </span>
              <span className={cn(
                "shrink-0 px-1 py-0.5 text-[9px] tracking-widest uppercase border",
                STATUS_BADGE[market.status] ?? "border-border text-muted-foreground",
              )}>
                {market.status}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {order.note ? `${order.note} · ` : ""}Created {formatCreatedAt(order.createdAt)}
            </span>
          </>
        ) : (
          <span className="truncate text-xs text-foreground">
            {order.note ?? truncateAddress(order.maker)}
          </span>
        )}
      </div>

      {/* Price */}
      <span className={cn(
        "hidden shrink-0 w-20 text-right text-xs font-semibold tabular-nums sm:block",
        side === "buy" ? "text-emerald-400" : "text-rose-400",
      )}>
        {price.toFixed(3)} TAB
      </span>

      {/* Amount */}
      <span className="hidden shrink-0 w-16 text-right text-xs tabular-nums text-muted-foreground sm:block">
        {amount}
      </span>

      {/* Total */}
      <span className="shrink-0 w-20 text-right text-xs font-semibold tabular-nums text-foreground">
        {total} TAB
      </span>

      {/* Expiry */}
      <span className="hidden shrink-0 w-24 text-right text-[10px] text-muted-foreground lg:block">
        {formatExpiry(order.expiry)}
      </span>

      {/* Action */}
      {isOwn ? (
        <button
          onClick={handleCancel}
          disabled={isPending}
          aria-label="Cancel order"
          className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      ) : order.marketId !== null ? (
        <button
          onClick={handleFill}
          disabled={isPending}
          aria-label="Take order"
          title={`Take ${side === "buy" ? "SELL" : "BUY"} side of this order`}
          className={cn(
            "shrink-0 p-1 transition-colors disabled:pointer-events-none",
            isFilling
              ? "text-amber-400"
              : "text-muted-foreground hover:text-amber-400",
          )}
        >
          <Zap className="size-3.5" aria-hidden />
        </button>
      ) : (
        <div className="shrink-0 w-[22px]" />
      )}
    </div>
  )
}