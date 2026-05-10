import { Link } from "@tanstack/react-router"
import { Flame, Users } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market, MarketCategory } from "@/features/market/types"
import { formatRelativeTime, formatTabShort, getMarketStats } from "@/features/market/lib/mock-stats"
import { MarketImage } from "@/features/market/components/market-image"

const CATEGORY_BADGE: Record<MarketCategory, string> = {
  Finance: "bg-amber-500/10 text-amber-400",
  Politics: "bg-blue-500/10 text-blue-400",
  Sport: "bg-emerald-500/10 text-emerald-400",
  Czech: "bg-purple-500/10 text-purple-400",
  Weather: "bg-cyan-500/10 text-cyan-400",
}

const CATEGORY_ACCENT: Record<MarketCategory, string> = {
  Finance: "border-t-amber-500/50",
  Politics: "border-t-blue-500/50",
  Sport: "border-t-emerald-500/50",
  Czech: "border-t-purple-500/50",
  Weather: "border-t-cyan-500/50",
}

function topOutcome(m: Market): { label: string; pct: number } | null {
  if (m.outcomeType === "binary") {
    return m.yesPrice >= m.noPrice
      ? { label: "YES", pct: m.yesPrice }
      : { label: "NO", pct: m.noPrice }
  }
  if (m.outcomeType === "multi") {
    const top = m.outcomes.reduce((a, b) => (a.price >= b.price ? a : b))
    return { label: top.label, pct: top.price }
  }
  return null
}

interface Props {
  market: Market
  variant?: "wide" | "tall"
  rank?: number
  className?: string
}

export function FeaturedMarketCard({ market, variant = "wide", rank, className }: Props) {
  const stats = getMarketStats(market)
  const top = topOutcome(market)
  const isUp = stats.delta24h >= 0

  return (
    <Link
      to="/markets/$marketId"
      params={{ marketId: market.id }}
      className={cn(
        "group/featured relative flex overflow-hidden rounded-none border-t-2 bg-card text-card-foreground ring-1 ring-foreground/10",
        CATEGORY_ACCENT[market.category],
        "transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:ring-foreground/25",
        "[@media(hover:hover)_and_(pointer:fine)]:motion-safe:hover:-translate-y-0.5",
        "active:scale-[0.99]",
        variant === "wide"
          ? "flex-col sm:flex-row sm:items-stretch"
          : "flex-col",
        className,
      )}
    >
      {/* Image */}
      <MarketImage
        market={market}
        size="card"
        className={cn(
          "shrink-0",
          variant === "wide"
            ? "aspect-[16/9] w-full sm:aspect-auto sm:h-auto sm:w-2/5"
            : "aspect-[16/9] w-full",
          "[&>svg]:transition-transform [&>svg]:duration-300 [&>svg]:ease-[cubic-bezier(0.23,1,0.32,1)]",
          "[@media(hover:hover)_and_(pointer:fine)]:group-hover/featured:[&>svg]:scale-[1.06]",
        )}
      />

      {/* Body */}
      <div className="flex flex-1 flex-col justify-between gap-4 p-4 sm:p-5">
        {/* Top row: rank + category + delta */}
        <div className="flex flex-wrap items-center gap-2">
          {rank !== undefined && (
            <span className="flex items-center gap-1 bg-foreground text-background px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest">
              <Flame aria-hidden className="size-3" />
              #{rank} Trending
            </span>
          )}
          <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", CATEGORY_BADGE[market.category])}>
            {market.category}
          </span>
          <span
            className={cn(
              "ml-auto text-[10px] font-semibold tabular-nums",
              isUp ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {isUp ? "+" : ""}
            {stats.delta24h.toFixed(1)}%
            <span className="ml-1 text-muted-foreground/50 font-normal">24h</span>
          </span>
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground text-pretty sm:text-lg">
          {market.title}
        </h3>

        {/* Bottom row: top outcome + stats */}
        <div className="flex items-end justify-between gap-3">
          {top && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">
                {top.label}
              </span>
              <span className="font-serif text-2xl leading-none tracking-[-0.02em] text-foreground tabular-nums sm:text-[1.75rem]">
                {top.pct}%
              </span>
            </div>
          )}

          <div className="flex flex-col items-end gap-1 text-[10px] tabular-nums">
            <span className="flex items-center gap-1 text-muted-foreground/80">
              <span className="font-semibold text-foreground">{formatTabShort(stats.volumeTab)}</span>
              <span className="uppercase tracking-widest">TAB vol</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground/60">
              <Users aria-hidden className="size-3" />
              <span>{stats.traders.toLocaleString("en-US")} traders</span>
            </span>
            <span className="text-muted-foreground/50">
              Closes {formatRelativeTime(market.closingDate)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
