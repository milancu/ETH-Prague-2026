import { cn } from "@workspace/ui/lib/utils"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import type { MarketCategory } from "@/features/market/types"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { MarketCard } from "@/features/market/components/market-card.tsx"
import { CreateMarketDialog } from "@/features/market/components/create-market-dialog"

type FilterCategory = "All" | MarketCategory

const CATEGORIES: FilterCategory[] = ["All", "Politics", "Sport", "Czech", "Finance", "Weather"]

const categoryParser = parseAsStringLiteral(CATEGORIES).withDefault("All")

export function MarketList() {
  const [activeCategory, setActiveCategory] = useQueryState("category", categoryParser)

  const { data, isLoading, isError } = useMarkets(
    activeCategory === "All" ? undefined : { category: activeCategory },
  )

  const markets = data?.markets ?? []
  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : isError
                ? "Could not load markets"
                : `${total} active prediction markets`}
          </p>
        </div>
        <CreateMarketDialog />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "shrink-0 px-3.5 py-1.5 text-xs font-medium",
              "transition-colors duration-150",
              activeCategory === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse bg-muted" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {isError ? "Backend unreachable — check the API server." : "No markets in this category."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((market, i) => (
            <MarketCard key={market.id} market={market} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}