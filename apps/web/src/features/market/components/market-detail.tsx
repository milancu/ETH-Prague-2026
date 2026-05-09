import { useMemo } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, Calendar, Copy } from "lucide-react"
import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { useMarket } from "@/features/market/hooks/use-market"
import { useMarketPrices } from "@/features/market/hooks/use-market-prices"
import { formatDate, marketStatusLabel } from "@/features/market/lib/utils"
import type { Market, MarketCategory } from "@/features/market/types"
import { OrderBook } from "@/features/orders/components/order-book"
import { TradingPanel } from "@/features/market/components/trading-panel"
import { ResolutionBar } from "@/features/market/components/resolution-bar"
import { CommentsSection } from "@/features/market/components/comments-section"

// ── Static config ─────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<MarketCategory, { badge: string; border: string }> = {
  Finance:  { badge: "bg-amber-500/10 text-amber-400",    border: "border-amber-500/20"   },
  Politics: { badge: "bg-blue-500/10 text-blue-400",      border: "border-blue-500/20"    },
  Sport:    { badge: "bg-emerald-500/10 text-emerald-400", border: "border-emerald-500/20" },
  Czech:    { badge: "bg-purple-500/10 text-purple-400",  border: "border-purple-500/20"  },
  Weather:  { badge: "bg-cyan-500/10 text-cyan-400",      border: "border-cyan-500/20"    },
}

// ── Meta row ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value, mono = false, truncate = false }: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}) {
  const copyable = mono && value.startsWith("0x")

  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="shrink-0 text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn(
          "text-xs text-foreground",
          mono && "font-mono",
          truncate && "max-w-[180px] truncate",
        )}>
          {value}
        </span>
        {copyable && (
          <button
            onClick={() => navigator.clipboard.writeText(value)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Copy"
          >
            <Copy className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-4 w-24 bg-muted" />
      <div className="h-8 w-3/4 bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="h-32 bg-muted" />
          <div className="h-24 bg-muted" />
        </div>
        <div className="h-64 bg-muted" />
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MarketDetail({ id }: { id: string }) {
  const { data: market, isLoading, isError } = useMarket(id)
  const livePrices = useMarketPrices(market)

  const liveMarket = useMemo((): Market | undefined => {
    if (!market || Object.keys(livePrices).length === 0) return market
    if (market.outcomeType === "binary") {
      return {
        ...market,
        yesPrice: livePrices["YES"] ?? market.yesPrice,
        noPrice:  livePrices["NO"]  ?? market.noPrice,
      }
    }
    if (market.outcomeType === "multi") {
      return {
        ...market,
        outcomes: market.outcomes.map(o => ({ ...o, price: livePrices[o.label] ?? o.price })),
      }
    }
    return market
  }, [market, livePrices])

  if (isLoading) return <DetailSkeleton />

  if (isError || !market) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-sm text-muted-foreground">Market not found.</p>
        <Link to="/" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          ← Back to markets
        </Link>
      </div>
    )
  }

  const cat = CATEGORY_CONFIG[market.category]
  const status = marketStatusLabel(market.status)

  return (
    <div className="flex flex-col gap-8">
      {/* Back — breadcrumb nav; "Markets" layoutId matches the list-page h1 */}
      <Link
        to="/"
        className="flex w-fit items-center gap-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        >
          <ArrowLeft className="size-5" />
        </motion.span>
        <motion.span
          layoutId="markets-label"
          className="inline-block text-2xl font-semibold tracking-tight"
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          Markets
        </motion.span>
      </Link>

      {/* Title row */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", cat.badge)}>
            {market.category}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] uppercase tracking-widest",
              market.status === "open"      && "border-emerald-500/30 text-emerald-400",
              market.status === "resolved"  && "border-border text-muted-foreground",
              market.status === "pending"   && "border-amber-500/30 text-amber-400",
              market.status === "cancelled" && "border-rose-500/30 text-rose-400",
            )}
          >
            {status}
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight text-foreground text-pretty">
          {market.title}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden />
            Closes <time dateTime={market.closingDate.toISOString()}>{formatDate(market.closingDate)}</time>
          </span>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">

        {/* Left — description, rules, metadata */}
        <div className="flex flex-col gap-6">
          {market.description && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Description</h2>
              <p className="text-sm leading-relaxed text-foreground/80">{market.description}</p>
            </section>
          )}

          {market.rules && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Resolution rules</h2>
              <p className="text-sm leading-relaxed text-foreground/80">{market.rules}</p>
            </section>
          )}

          {/* Technical details */}
          <section className="flex flex-col gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Details</h2>
            <div className={cn("border border-border px-4", cat.border, "border-l-2")}>
              <MetaRow label="Creator"      value={market.creator}      mono truncate />
              <MetaRow label="Condition ID" value={market.conditionId}  mono truncate />
              <MetaRow label="Tx Hash"      value={market.txHash}       mono truncate />
              <MetaRow label="Chain"        value={`${market.chainId}`} />
              <MetaRow label="Created"      value={formatDate(market.createdAt)} />
            </div>
          </section>

          {/* Order book */}
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Order Book</h2>
            <OrderBook market={liveMarket ?? market} />
          </section>

          {/* Comments */}
          <CommentsSection marketId={market.id} />
        </div>

        {/* Right — trading panel */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <TradingPanel market={liveMarket ?? market} />
          <ResolutionBar market={liveMarket ?? market} />
        </div>
      </div>
    </div>
  )
}
