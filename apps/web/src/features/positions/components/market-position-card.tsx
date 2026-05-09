import { Link } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { formatBalance } from "@/features/positions/lib/utils"
import type { Position } from "@/features/positions/hooks/use-positions"
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

const POSITIVE_OUTCOMES = new Set(["YES", "Higher"])

interface MarketPositionCardProps {
  market: Market
  positions: Position[]
}

export function MarketPositionCard({ market, positions }: MarketPositionCardProps) {
  return (
    <div className="border border-border">
      {/* Market header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <span className={cn(
          "shrink-0 px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase",
          CATEGORY_BADGE[market.category],
        )}>
          {market.category}
        </span>

        <Link
          to="/markets/$marketId"
          params={{ marketId: market.id }}
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground hover:underline underline-offset-2"
        >
          {market.title}
        </Link>

        <span className={cn(
          "shrink-0 border px-1.5 py-0.5 text-[9px] uppercase tracking-widest",
          STATUS_BADGE[market.status] ?? "border-border text-muted-foreground",
        )}>
          {market.status}
        </span>
      </div>

      {/* Column header */}
      <div className="flex items-center gap-3 px-3 py-1 border-b border-border">
        <span className="w-16 shrink-0" />
        <span className="flex-1 text-[9px] uppercase tracking-widest text-muted-foreground">
          Raw tokens
        </span>
        <span className="w-32 shrink-0 text-right text-[9px] uppercase tracking-widest text-muted-foreground">
          Wrapped ERC-20
        </span>
      </div>

      {/* Outcome rows */}
      {positions.map(p => {
        const isPositive = POSITIVE_OUTCOMES.has(p.outcomeLabel)
        const hasWrapped = p.wrapperAddress !== null

        return (
          <div
            key={p.outcomeLabel}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0"
          >
            <span className={cn(
              "shrink-0 w-16 text-center text-[10px] font-bold tracking-widest uppercase py-0.5",
              isPositive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-rose-500/10 text-rose-400",
            )}>
              {p.outcomeLabel}
            </span>

            {/* Raw (ERC-1155) balance */}
            <div className="flex-1">
              {p.balance > 0n ? (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {formatBalance(p.balance)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>

            {/* Wrapped ERC-20 balance */}
            <div className="w-32 shrink-0 text-right">
              {!hasWrapped ? (
                <span className="text-xs text-muted-foreground">no wrapper</span>
              ) : p.wrappedBalance > 0n ? (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {formatBalance(p.wrappedBalance)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}