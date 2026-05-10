import { Link } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { MarketImage } from "@/features/market/components/market-image"

const MAX = 4

function pickPrice(m: Market): { label: string; pct: number } | null {
  if (m.outcomeType === "binary") return { label: "YES", pct: m.yesPrice }
  if (m.outcomeType === "multi") {
    const top = m.outcomes.reduce((a, b) => (a.price >= b.price ? a : b))
    return { label: top.label, pct: top.price }
  }
  return null
}

interface Props {
  market: Market
}

export function SimilarMarkets({ market }: Props) {
  const { data, isLoading } = useMarkets({ category: market.category })

  const items = (data?.markets ?? [])
    .filter(m => m.id !== market.id)
    .filter(m => m.status === "open" || m.status === "pending")
    .slice(0, MAX)

  if (isLoading || items.length === 0) return null

  return (
    <section className="flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          More in {market.category}
        </h2>
        <Link
          to="/"
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60",
            "transition-colors duration-150 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
          )}
        >
          See all <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((m, i) => {
          const price = pickPrice(m)
          return (
            <Link
              key={m.id}
              to="/markets/$marketId"
              params={{ marketId: m.id }}
              className={cn(
                "group/sim relative flex items-stretch gap-3 overflow-hidden border border-border/60 bg-card/40",
                "transition-[transform,border-color,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "[@media(hover:hover)_and_(pointer:fine)]:hover:border-foreground/25",
                "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-card/70",
                "active:scale-[0.99]",
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both",
              )}
              style={{ animationDelay: `${Math.min(i * 50, 200)}ms` }}
            >
              <MarketImage market={m} size="thumb" className="aspect-square w-20 shrink-0" />
              <div className="flex flex-1 flex-col justify-between gap-1.5 py-2 pr-3">
                <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground/90 [@media(hover:hover)_and_(pointer:fine)]:group-hover/sim:text-foreground">
                  {m.title}
                </p>
                {price && (
                  <div className="flex items-center gap-2 text-[10px] tabular-nums">
                    <span className="font-bold uppercase tracking-widest text-emerald-400">
                      {price.label}
                    </span>
                    <span className="font-semibold text-foreground/80">{price.pct}%</span>
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
