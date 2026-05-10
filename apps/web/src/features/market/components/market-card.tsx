import { useState, useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { parseEther } from "viem"
import { cn } from "@workspace/ui/lib/utils"
import { useMarketPrices } from "@/features/market/hooks/use-market-prices"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { usePlaceOrder } from "@/features/orders/hooks/use-place-order"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Calendar, MessageSquare, TrendingDown, TrendingUp, Users } from "lucide-react"
import { formatRelativeTime, formatTabShort, getMarketStats } from "@/features/market/lib/mock-stats"
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/animate-ui/primitives/base/progress"
import type {
  BinaryMarket,
  Market,
  MarketCategory,
  MultiMarket,
  ScalarMarket,
} from "@/features/market/types"
import {
  formatVolume,
  formatDate,
  marketStatusLabel,
} from "@/features/market/lib/utils"
import { MarketImage } from "@/features/market/components/market-image"

// ── Static config (hoisted — never recreated on render) ──────────────────────

const CATEGORY_CONFIG: Record<
  MarketCategory,
  { badge: string; accent: string; bar: string }
> = {
  Finance:  { badge: "bg-amber-500/10  text-amber-400",   accent: "border-t-amber-500/50",   bar: "bg-amber-500/60"   },
  Politics: { badge: "bg-blue-500/10   text-blue-400",    accent: "border-t-blue-500/50",    bar: "bg-blue-500/60"    },
  Sport:    { badge: "bg-emerald-500/10 text-emerald-400", accent: "border-t-emerald-500/50", bar: "bg-emerald-500/60" },
  Czech:    { badge: "bg-purple-500/10 text-purple-400",  accent: "border-t-purple-500/50",  bar: "bg-purple-500/60"  },
  Weather:  { badge: "bg-cyan-500/10   text-cyan-400",    accent: "border-t-cyan-500/50",    bar: "bg-cyan-500/60"    },
}

const BINARY_SIDES = [
  {
    id: "yes" as const,
    label: "YES",
    activeBg: "bg-emerald-500/10",
    activeRing: "ring-emerald-500/30",
    bar: "bg-emerald-500",
    text: "text-emerald-400",
  },
  {
    id: "no" as const,
    label: "NO",
    activeBg: "bg-rose-500/10",
    activeRing: "ring-rose-500/30",
    bar: "bg-rose-500",
    text: "text-rose-400",
  },
] as const

// ── Closing-time hint (relative + urgency colouring) ────────────────────────

function ClosingHint({ date }: { date: Date }) {
  const ms = date.getTime() - Date.now()
  const hours = ms / 3_600_000
  const urgent = hours > 0 && hours < 24
  const past = hours <= 0
  return (
    <div
      className={cn(
        "flex items-center gap-1 text-[10px]",
        past
          ? "text-muted-foreground/40"
          : urgent
            ? "text-amber-400"
            : "text-muted-foreground",
      )}
      title={formatDate(date)}
    >
      <Calendar aria-hidden className="size-3 shrink-0" />
      <time dateTime={date.toISOString()}>
        {past ? "Closed" : `Closes ${formatRelativeTime(date)}`}
      </time>
    </div>
  )
}

// ── Activity stats row (under title) ─────────────────────────────────────────

function MarketCardStats({ market }: { market: Market }) {
  const s = getMarketStats(market)
  const isUp = s.delta24h >= 0
  const TrendIcon = isUp ? TrendingUp : TrendingDown
  return (
    <div className="flex items-center justify-between gap-3 text-[10px] tabular-nums text-muted-foreground/80">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex items-center gap-1">
          <span className="font-semibold text-foreground/90">{formatTabShort(s.volumeTab)}</span>
          <span className="uppercase tracking-widest text-muted-foreground/50">vol</span>
        </span>
        <span className="text-muted-foreground/30">·</span>
        <span className="flex items-center gap-1">
          <Users aria-hidden className="size-3 text-muted-foreground/50" />
          <span>{s.traders.toLocaleString("en-US")}</span>
        </span>
        {s.comments > 0 && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <span className="flex items-center gap-1">
              <MessageSquare aria-hidden className="size-3 text-muted-foreground/50" />
              <span>{s.comments}</span>
            </span>
          </>
        )}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-0.5 font-semibold",
          isUp ? "text-emerald-400" : "text-rose-400",
        )}
      >
        <TrendIcon aria-hidden className="size-3" />
        {isUp ? "+" : ""}{s.delta24h.toFixed(1)}%
      </span>
    </div>
  )
}

// ── Binary outcome selector ──────────────────────────────────────────────────

function BinarySection({
  market,
  selected,
  onSelect,
}: {
  market: BinaryMarket
  selected: string | null
  onSelect: (o: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {BINARY_SIDES.map(({ id, label, activeBg, activeRing, bar, text }) => {
        const price = id === "yes" ? market.yesPrice : market.noPrice
        const isSelected = selected === id
        return (
          <button
            key={id}
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : id)}
            className={cn(
              "flex items-center gap-3 px-2.5 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "active:scale-[0.97]",
              isSelected
                ? cn(activeBg, "ring-1", activeRing)
                : "bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60",
            )}
          >
            <span className={cn("w-7 shrink-0 text-[11px] font-bold tracking-widest", text)}>
              {label}
            </span>
            <Progress value={price} className="flex-1">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", bar)} />
              </ProgressTrack>
            </Progress>
            <span className={cn("w-9 shrink-0 text-right text-xs font-semibold tabular-nums", text)}>
              {price}%
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Multi outcome selector ───────────────────────────────────────────────────

function MultiSection({
  market,
  cat,
  selected,
  onSelect,
}: {
  market: MultiMarket
  cat: (typeof CATEGORY_CONFIG)[MarketCategory]
  selected: string | null
  onSelect: (o: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {market.outcomes.map((outcome) => {
        const isSelected = selected === outcome.id
        return (
          <button
            key={outcome.id}
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : outcome.id)}
            className={cn(
              "flex flex-col gap-1.5 px-2.5 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "active:scale-[0.97]",
              isSelected
                ? "bg-primary/10 ring-1 ring-primary/30"
                : "bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60",
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs font-medium text-foreground text-left">{outcome.label}</span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{outcome.price}%</span>
            </div>
            <Progress value={outcome.price} className="w-full">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", cat.bar)} />
              </ProgressTrack>
            </Progress>
          </button>
        )
      })}
    </div>
  )
}

const SCALAR_SIDES = [
  {
    id: "higher" as const,
    label: "HIGHER",
    activeBg: "bg-emerald-500/10",
    activeRing: "ring-emerald-500/30",
    text: "text-emerald-400",
  },
  {
    id: "lower" as const,
    label: "LOWER",
    activeBg: "bg-rose-500/10",
    activeRing: "ring-rose-500/30",
    text: "text-rose-400",
  },
] as const

// ── Scalar outcome selector ──────────────────────────────────────────────────

function ScalarSection({
  market,
  selected,
  onSelect,
}: {
  market: ScalarMarket
  selected: string | null
  onSelect: (o: string | null) => void
}) {
  const range = market.scalarMax - market.scalarMin
  const consensusPct = range === 0 ? 0 : ((market.currentValue - market.scalarMin) / range) * 100

  return (
    <div className="flex flex-col gap-3">
      {/* Read-only market consensus */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
          Market Consensus
        </span>
        <span className="font-semibold tabular-nums text-foreground text-xs">
          {formatVolume(market.currentValue)}&nbsp;{market.scalarUnit}
        </span>
      </div>

      <Progress value={consensusPct}>
        <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
          <ProgressIndicator className="h-full bg-primary/60" />
        </ProgressTrack>
      </Progress>

      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{formatVolume(market.scalarMin)}&nbsp;{market.scalarUnit}</span>
        <span>{formatVolume(market.scalarMax)}&nbsp;{market.scalarUnit}</span>
      </div>

      {/* Direction selector */}
      <div className="flex flex-col gap-1">
        {SCALAR_SIDES.map(({ id, label, activeBg, activeRing, text }) => {
          const isSelected = selected === id
          const hint = id === "higher"
            ? `> ${formatVolume(market.currentValue)} ${market.scalarUnit}`
            : `< ${formatVolume(market.currentValue)} ${market.scalarUnit}`
          return (
            <button
              key={id}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : id)}
              className={cn(
                "flex items-center justify-between px-2.5 py-2",
                "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "active:scale-[0.97]",
                isSelected
                  ? cn(activeBg, "ring-1", activeRing)
                  : "bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60",
              )}
            >
              <span className={cn("text-[11px] font-bold tracking-widest", text)}>
                {label}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Bet form (shared) ────────────────────────────────────────────────────────

function BetForm({
  amount,
  onAmountChange,
  onSubmit,
  isPending,
}: {
  amount: string
  onAmountChange: (v: string) => void
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <div className="flex items-center gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150 motion-safe:fill-mode-both">
      <div className="relative flex-1">
        <Input
          type="number"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0…"
          min="0"
          name="bet-amount"
          autoComplete="off"
          aria-label="Bet amount in TAB"
          className="pr-10"
          disabled={isPending}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-semibold tracking-widest text-muted-foreground uppercase"
        >
          TAB
        </span>
      </div>
      <Button onClick={onSubmit} disabled={Number(amount) <= 0 || isPending} className="shrink-0">
        {isPending ? "Placing…" : "Place Order"}
      </Button>
    </div>
  )
}

// ── Market card ──────────────────────────────────────────────────────────────

interface MarketCardProps {
  market: Market
  index: number
  className?: string
}

export function MarketCard({ market, index, className }: MarketCardProps) {
  const navigate = useNavigate()
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null)
  const [betAmount, setBetAmount] = useState("")
  const { placeOrder, isPending } = usePlaceOrder()
  const livePrices = useMarketPrices(market)

  const liveMarket = useMemo((): Market => {
    if (Object.keys(livePrices).length === 0) return market
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

  const showBetForm = selectedOutcome !== null
  const cat = CATEGORY_CONFIG[market.category]
  const status = marketStatusLabel(market.status)

  async function handlePlaceOrder() {
    if (selectedOutcome === null || !betAmount) return
    try {
      // quick-bet from card uses 50 cents as default limit price
      await placeOrder({
        market,
        outcomeId: selectedOutcome,
        side: "buy",
        quantityWei: parseEther(betAmount),
        priceWei: parseEther("0.5"),
      })
      setBetAmount("")
      setSelectedOutcome(null)
    } catch {
      // toast already shown by usePlaceOrder
    }
  }

  return (
    <Card
      onClick={() => navigate({ to: "/markets/$marketId", params: { marketId: market.id } })}
      className={cn(
        "cursor-pointer border-t-2 pt-0 group/marketcard",
        cat.accent,
        "transition-[box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:ring-foreground/20",
        "[@media(hover:hover)_and_(pointer:fine)]:motion-safe:hover:-translate-y-0.5",
        "motion-safe:[&:active:not(:has(:active))]:scale-[0.97]",
        "motion-safe:[&:active:not(:has(:active))]:translate-y-0",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[97%]",
        "motion-safe:slide-in-from-bottom-3 motion-safe:duration-250 motion-safe:fill-mode-both",
        "motion-safe:[animation-timing-function:cubic-bezier(0.23,1,0.32,1)]",
        className,
      )}
      style={{ animationDelay: `${Math.min(index * 55, 350)}ms` }}
    >
      <MarketImage
        market={market}
        size="card"
        className={cn(
          "aspect-[16/7] w-full",
          "[&>svg]:transition-transform [&>svg]:duration-300 [&>svg]:ease-[cubic-bezier(0.23,1,0.32,1)]",
          "[@media(hover:hover)_and_(pointer:fine)]:group-hover/marketcard:[&>svg]:scale-[1.08]",
        )}
      />
      <CardHeader>
        <CardTitle>
          <span className={cn("px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase", cat.badge)}>
            {market.category}
          </span>
        </CardTitle>
        <CardAction>
          <ClosingHint date={market.closingDate} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="text-sm font-medium leading-snug text-foreground text-pretty">
          {market.title}
        </p>

        {/* Activity row — volume / traders / comments / 24h delta */}
        <MarketCardStats market={market} />

        {/* stopPropagation so clicks on interactive elements don't bubble to the card */}
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4 pb-2">
          {liveMarket.outcomeType === "binary" && (
            <BinarySection
              market={liveMarket}
              selected={selectedOutcome}
              onSelect={setSelectedOutcome}
            />
          )}
          {liveMarket.outcomeType === "multi" && (
            <MultiSection
              market={liveMarket}
              cat={cat}
              selected={selectedOutcome}
              onSelect={setSelectedOutcome}
            />
          )}
          {liveMarket.outcomeType === "scalar" && (
            <ScalarSection
              market={liveMarket}
              selected={selectedOutcome}
              onSelect={setSelectedOutcome}
            />
          )}

          {showBetForm && (
            <BetForm
              amount={betAmount}
              onAmountChange={setBetAmount}
              onSubmit={handlePlaceOrder}
              isPending={isPending}
            />
          )}
        </div>
      </CardContent>

      <CardFooter className="justify-end">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] tracking-widest uppercase",
            (market.status === "open" || market.status === "pending") && "border-emerald-500/30 text-emerald-400",
            market.status === "resolved"  && "border-border text-muted-foreground",
            market.status === "cancelled" && "border-rose-500/30 text-rose-400",
          )}
        >
          {status}
        </Badge>
      </CardFooter>
    </Card>
  )
}