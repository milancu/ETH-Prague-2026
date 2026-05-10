import { useEffect, useMemo, useState } from "react"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import { motion } from "motion/react"
import { CloudSun, Landmark, Sparkles, TrendingUp, Trophy } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { MarketCategory } from "@/features/market/types"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { MarketCard } from "@/features/market/components/market-card.tsx"
import { MarketsHeaderControls } from "@/features/market/components/markets-header-controls"
import { TrendingStripe } from "@/features/market/components/trending-stripe"
import { MarketCommandPalette } from "@/features/market/components/market-command-palette"
import {
  formatTabShort,
  getMarketStats,
  sortMarkets,
  type SortKey,
} from "@/features/market/lib/mock-stats"

// ── Filter taxonomy ──────────────────────────────────────────────────────────

type FilterCategory = "All" | MarketCategory

const CATEGORIES: FilterCategory[] = ["All", "Politics", "Sport", "Czech", "Finance", "Weather"]

const CATEGORY_ICON: Record<FilterCategory, LucideIcon | null> = {
  All: null,
  Finance: TrendingUp,
  Politics: Landmark,
  Sport: Trophy,
  Czech: Sparkles,
  Weather: CloudSun,
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "volume", label: "Highest volume" },
  { key: "closing", label: "Closing soon" },
  { key: "newest", label: "Newest" },
]

const categoryParser = parseAsStringLiteral(CATEGORIES).withDefault("All")
const sortParser = parseAsStringLiteral(["trending", "volume", "closing", "newest"] as const).withDefault("trending")

const SLIDE_SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.6 }

// ── Component ────────────────────────────────────────────────────────────────

export function MarketList() {
  const [activeCategory, setActiveCategory] = useQueryState("category", categoryParser)
  const [sortKey, setSortKey] = useQueryState("sort", sortParser)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Fetch all markets — counts/sort/filtering happens client-side. Cheap with
  // <1k markets and avoids cache-key thrash from server-side filters.
  const { data, isLoading, isError } = useMarkets()
  const allMarkets = useMemo(() => data?.markets ?? [], [data])

  // Per-category counts (used in the filter pills).
  const counts = useMemo(() => {
    const map: Record<FilterCategory, number> = {
      All: allMarkets.length,
      Politics: 0,
      Sport: 0,
      Czech: 0,
      Finance: 0,
      Weather: 0,
    }
    for (const m of allMarkets) map[m.category]++
    return map
  }, [allMarkets])

  // Filtered + sorted list for the main grid.
  const visibleMarkets = useMemo(() => {
    const filtered =
      activeCategory === "All"
        ? allMarkets
        : allMarkets.filter((m) => m.category === activeCategory)
    return sortMarkets(filtered, sortKey)
  }, [allMarkets, activeCategory, sortKey])

  // Trending stripe shows only on the unfiltered "All" view to avoid duplicate
  // cards (top-trending would otherwise appear both in the stripe and grid).
  const showTrendingStripe = activeCategory === "All"
  const stripeIds = useMemo(() => {
    if (!showTrendingStripe) return new Set<string>()
    return new Set(
      sortMarkets(allMarkets, "trending")
        .filter((m) => m.status === "open" || m.status === "pending")
        .slice(0, 2)
        .map((m) => m.id),
    )
  }, [allMarkets, showTrendingStripe])

  const gridMarkets = useMemo(
    () => (showTrendingStripe ? visibleMarkets.filter((m) => !stripeIds.has(m.id)) : visibleMarkets),
    [visibleMarkets, stripeIds, showTrendingStripe],
  )

  // ⌘K opens the palette globally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── Stats bar (header sub-line) ─────────────────────────────────────────────
  const totalVolume = useMemo(
    () => allMarkets.reduce((sum, m) => sum + getMarketStats(m).volumeTab, 0),
    [allMarkets],
  )
  const totalTraders = useMemo(
    () => allMarkets.reduce((sum, m) => sum + getMarketStats(m).traders, 0),
    [allMarkets],
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-2">
          <motion.h1
            layoutId="markets-label"
            className="w-fit text-2xl font-semibold tracking-tight"
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          >
            Markets
          </motion.h1>
          {!isLoading && !isError && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>
                <span className="font-semibold text-foreground/85">{counts.All}</span>{" "}
                <span className="uppercase tracking-widest text-muted-foreground/60">markets</span>
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span>
                <span className="font-semibold text-foreground/85">{formatTabShort(totalVolume)}</span>{" "}
                <span className="uppercase tracking-widest text-muted-foreground/60">TAB vol</span>
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span>
                <span className="font-semibold text-foreground/85">{totalTraders.toLocaleString("en-US")}</span>{" "}
                <span className="uppercase tracking-widest text-muted-foreground/60">traders</span>
              </span>
            </p>
          )}
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {isError && <p className="text-xs text-destructive">Could not load markets</p>}
        </div>

        <MarketsHeaderControls onSearch={() => setPaletteOpen(true)} />
      </div>

      {/* Filter row — sliding pill indicator + sort dropdown */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICON[cat]
            const active = activeCategory === cat
            const count = counts[cat]
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                aria-pressed={active}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium",
                  "transition-colors duration-150",
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="category-pill"
                    aria-hidden
                    className="absolute inset-0 -z-0 bg-primary"
                    transition={SLIDE_SPRING}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {Icon && <Icon aria-hidden className="size-3.5" />}
                  <span>{cat}</span>
                  <span
                    className={cn(
                      "tabular-nums text-[10px] font-semibold",
                      active ? "opacity-70" : "opacity-50",
                    )}
                  >
                    {count}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-8 w-fit min-w-[148px] text-xs">
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
                Sort
              </span>
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Trending stripe — only on All + when there are 2+ candidates */}
      {showTrendingStripe && !isLoading && !isError && allMarkets.length >= 2 && (
        <TrendingStripe markets={allMarkets} />
      )}

      {/* Section heading separator before main grid (only if stripe rendered) */}
      {showTrendingStripe && gridMarkets.length > 0 && (
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            All markets
          </h2>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
            · {gridMarkets.length}
          </span>
        </div>
      )}

      {/* Main grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} delay={i * 60} />
          ))}
        </div>
      ) : gridMarkets.length === 0 ? (
        <EmptyState
          isError={isError}
          category={activeCategory === "All" ? null : activeCategory}
        />
      ) : (
        <div className="grid grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gridMarkets.map((market, i) => (
            <MarketCard
              key={market.id}
              market={market}
              index={i}
              // Bento: every 7th card spans 2 cols on lg — subtle rhythm,
              // dense flow fills the holes left behind.
              className={cn((i + 1) % 7 === 0 && "lg:col-span-2")}
            />
          ))}
        </div>
      )}

      {/* ⌘K palette */}
      <MarketCommandPalette
        markets={allMarkets}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      className="relative h-56 overflow-hidden bg-card ring-1 ring-foreground/10"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
      <style>{`@keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>
    </div>
  )
}

function EmptyState({ isError, category }: { isError: boolean; category: MarketCategory | null }) {
  if (isError) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Backend unreachable — check the API server.
      </p>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-border py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {category
          ? `No markets in ${category} yet.`
          : "No markets here yet."}
      </p>
      <p className="text-xs text-muted-foreground/60">Be the first — create one.</p>
    </div>
  )
}

