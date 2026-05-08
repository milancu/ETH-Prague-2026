import { useState, useMemo } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, Calendar, ExternalLink, Copy } from "lucide-react"
import { parseEther } from "viem"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/animate-ui/primitives/base/progress"
import { useMarket } from "@/features/market/hooks/use-market"
import { useMarketPrices } from "@/features/market/hooks/use-market-prices"
import { formatVolume, formatDate, marketStatusLabel } from "@/features/market/lib/utils"
import type { BinaryMarket, Market, MarketCategory, MultiMarket, ScalarMarket } from "@/features/market/types"
import { OrderBook } from "@/features/orders/components/order-book"
import { usePlaceOrder } from "@/features/orders/hooks/use-place-order"

// ── Static config ─────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<MarketCategory, { badge: string; accent: string; bar: string; border: string }> = {
  Finance:  { badge: "bg-amber-500/10 text-amber-400",    accent: "text-amber-400",   bar: "bg-amber-500/70",   border: "border-amber-500/20"   },
  Politics: { badge: "bg-blue-500/10 text-blue-400",      accent: "text-blue-400",    bar: "bg-blue-500/70",    border: "border-blue-500/20"    },
  Sport:    { badge: "bg-emerald-500/10 text-emerald-400", accent: "text-emerald-400", bar: "bg-emerald-500/70", border: "border-emerald-500/20" },
  Czech:    { badge: "bg-purple-500/10 text-purple-400",  accent: "text-purple-400",  bar: "bg-purple-500/70",  border: "border-purple-500/20"  },
  Weather:  { badge: "bg-cyan-500/10 text-cyan-400",      accent: "text-cyan-400",    bar: "bg-cyan-500/70",    border: "border-cyan-500/20"    },
}

// ── Binary ────────────────────────────────────────────────────────────────────

function BinaryPanel({ market, selected, onSelect }: {
  market: BinaryMarket
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  const sides = [
    { id: "yes", label: "YES", price: market.yesPrice, activeBg: "bg-emerald-500/10", ring: "ring-emerald-500/30", bar: "bg-emerald-500", text: "text-emerald-400" },
    { id: "no",  label: "NO",  price: market.noPrice,  activeBg: "bg-rose-500/10",    ring: "ring-rose-500/30",    bar: "bg-rose-500",    text: "text-rose-400"    },
  ] as const

  return (
    <div className="flex flex-col gap-2">
      {sides.map(({ id, label, price, activeBg, ring, bar, text }) => {
        const active = selected === id
        return (
          <button
            key={id}
            aria-pressed={active}
            onClick={() => onSelect(active ? null : id)}
            className={cn(
              "flex items-center gap-4 px-4 py-3",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
            )}
          >
            <span className={cn("w-8 shrink-0 text-sm font-bold tracking-widest", text)}>{label}</span>
            <Progress value={price} className="flex-1">
              <ProgressTrack className="h-1.5 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", bar)} />
              </ProgressTrack>
            </Progress>
            <span className={cn("w-12 shrink-0 text-right text-sm font-bold tabular-nums", text)}>{price}%</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Multi ─────────────────────────────────────────────────────────────────────

function MultiPanel({ market, cat, selected, onSelect }: {
  market: MultiMarket
  cat: (typeof CATEGORY_CONFIG)[MarketCategory]
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {market.outcomes.map((outcome) => {
        const active = selected === outcome.id
        return (
          <button
            key={outcome.id}
            aria-pressed={active}
            onClick={() => onSelect(active ? null : outcome.id)}
            className={cn(
              "flex items-center gap-4 px-4 py-3",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted hover:bg-muted/60",
            )}
          >
            <Progress value={outcome.price} className="flex-1">
              <ProgressTrack className="h-1.5 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", cat.bar)} />
              </ProgressTrack>
            </Progress>
            <span className="shrink-0 text-sm font-medium text-foreground">{outcome.label}</span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground">{outcome.price}%</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Scalar ────────────────────────────────────────────────────────────────────

function ScalarPanel({ market, selected, onSelect }: {
  market: ScalarMarket
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  const range = market.scalarMax - market.scalarMin
  const pct = range === 0 ? 0 : ((market.currentValue - market.scalarMin) / range) * 100

  const sides = [
    { id: "higher", label: "HIGHER", hint: `> ${formatVolume(market.currentValue)} ${market.scalarUnit}`, activeBg: "bg-emerald-500/10", ring: "ring-emerald-500/30", text: "text-emerald-400" },
    { id: "lower",  label: "LOWER",  hint: `< ${formatVolume(market.currentValue)} ${market.scalarUnit}`, activeBg: "bg-rose-500/10",    ring: "ring-rose-500/30",    text: "text-rose-400"    },
  ] as const

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground uppercase tracking-widest">Market Consensus</span>
          <span className="font-semibold tabular-nums text-foreground">{formatVolume(market.currentValue)} {market.scalarUnit}</span>
        </div>
        <Progress value={pct}>
          <ProgressTrack className="h-2 w-full overflow-hidden bg-white/8">
            <ProgressIndicator className="h-full bg-primary/70" />
          </ProgressTrack>
        </Progress>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{formatVolume(market.scalarMin)} {market.scalarUnit}</span>
          <span>{formatVolume(market.scalarMax)} {market.scalarUnit}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {sides.map(({ id, label, hint, activeBg, ring, text }) => {
          const active = selected === id
          return (
            <button
              key={id}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : id)}
              className={cn(
                "flex items-center justify-between px-4 py-3",
                "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
              )}
            >
              <span className={cn("text-sm font-bold tracking-widest", text)}>{label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Bet form ──────────────────────────────────────────────────────────────────

function BetForm({
  amount,
  onChange,
  onSubmit,
  isPending,
}: {
  amount: string
  onChange: (v: string) => void
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <div className="flex gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
      <div className="relative flex-1">
        <Input
          type="number"
          value={amount}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0…"
          min="0"
          aria-label="Bet amount in TAB"
          className="pr-12"
          disabled={isPending}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          TAB
        </span>
      </div>
      <Button
        onClick={onSubmit}
        disabled={Number(amount) <= 0 || isPending}
        className="shrink-0 px-6"
      >
        {isPending ? "Placing…" : "Place Order"}
      </Button>
    </div>
  )
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

// ── Outcome panel switcher ────────────────────────────────────────────────────

function OutcomePanel({ market, cat, selected, onSelect }: {
  market: Market
  cat: (typeof CATEGORY_CONFIG)[MarketCategory]
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  if (market.outcomeType === "binary") return <BinaryPanel market={market} selected={selected} onSelect={onSelect} />
  if (market.outcomeType === "multi")  return <MultiPanel  market={market} cat={cat} selected={selected} onSelect={onSelect} />
  return <ScalarPanel market={market} selected={selected} onSelect={onSelect} />
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
  const [selected, setSelected] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const { placeOrder, isPending } = usePlaceOrder()
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

  async function handlePlaceOrder() {
    if (!market || selected === null || !amount) return
    try {
      await placeOrder({
        market,
        outcomeId: selected,
        tabAmountWei: parseEther(amount),
      })
      setAmount("")
      setSelected(null)
    } catch {
      // toast already shown by usePlaceOrder
    }
  }

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
      {/* Back */}
      <Link
        to="/"
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Markets
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
            <OrderBook marketId={market.marketId} />
          </section>
        </div>

        {/* Right — betting panel */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <div className={cn("border border-border p-4 flex flex-col gap-4", cat.border, "border-t-2")}>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Place a bet
            </h2>
            <OutcomePanel market={liveMarket ?? market} cat={cat} selected={selected} onSelect={setSelected} />
            {selected !== null && (
              <BetForm
                amount={amount}
                onChange={setAmount}
                onSubmit={handlePlaceOrder}
                isPending={isPending}
              />
            )}
          </div>

          <div className="border border-border px-4 py-3 flex items-start gap-2 text-[11px] text-muted-foreground">
            <ExternalLink className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>Bond: <span className="font-semibold text-foreground">50 TAB</span> locked until resolution.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
