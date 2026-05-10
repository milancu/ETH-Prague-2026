import { Flame } from "lucide-react"
import type { Market } from "@/features/market/types"
import { sortMarkets } from "@/features/market/lib/mock-stats"
import { FeaturedMarketCard } from "@/features/market/components/featured-market-card"

interface Props {
  markets: Market[]
}

/**
 * Top-of-page strip with two large featured cards (highest "trending" score).
 * On mobile they stack; on lg they sit side-by-side, the first one wider.
 */
export function TrendingStripe({ markets }: Props) {
  const top = sortMarkets(markets, "trending")
    .filter((m) => m.status === "open" || m.status === "pending")
    .slice(0, 2)

  if (top.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Flame aria-hidden className="size-3.5 text-amber-400" />
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Trending now
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
          · last 24h
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {top[0] && (
          <FeaturedMarketCard
            market={top[0]}
            variant="wide"
            rank={1}
            className="lg:col-span-3"
          />
        )}
        {top[1] && (
          <FeaturedMarketCard
            market={top[1]}
            variant="tall"
            rank={2}
            className="lg:col-span-2"
          />
        )}
      </div>
    </section>
  )
}
