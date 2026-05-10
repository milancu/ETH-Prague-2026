import { Link } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { formatBalance } from "@/features/positions/lib/utils"
import type { Position } from "@/features/positions/hooks/use-positions"

interface PositionRowProps {
  position: Position
}

export function PositionRow({ position }: PositionRowProps) {
  const isPositive = position.outcomeLabel === "YES" || position.outcomeLabel === "Higher"

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0">
      <span className={cn(
        "shrink-0 w-14 text-center text-[10px] font-bold tracking-widest uppercase py-0.5",
        isPositive
          ? "bg-emerald-500/10 text-emerald-400"
          : "bg-rose-500/10 text-rose-400",
      )}>
        {position.outcomeLabel}
      </span>

      <Link
        to="/markets/$marketId"
        params={{ marketId: String(position.marketId) }}
        className="min-w-0 flex-1 truncate text-xs text-foreground hover:underline underline-offset-4"
      >
        {position.marketTitle}
      </Link>

      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {formatBalance(position.balance)}
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground w-10 text-right">
        tokens
      </span>
    </div>
  )
}