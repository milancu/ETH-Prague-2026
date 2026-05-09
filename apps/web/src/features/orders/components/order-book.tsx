import { useMemo } from "react"
import { useReadContracts } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import {
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"
import type { Order } from "@/features/orders/types"

// ── Constants ─────────────────────────────────────────────────────────────────

const TAB = TABCOIN_ADDRESS.toLowerCase()
const MAX_ROWS = 5

// ── Palettes ──────────────────────────────────────────────────────────────────

interface Palette {
  label: string       // outcome label text color
  bid: string         // bid depth bar bg
  headerBg: string    // header tint
  borderLeft: string  // left accent edge
  spreadLine: string  // horizontal line color in shared spread
}

const PALETTES: Palette[] = [
  {
    label:      "text-emerald-400",
    bid:        "bg-emerald-500/15",
    headerBg:   "bg-emerald-500/[0.05]",
    borderLeft: "border-l-emerald-500/50",
    spreadLine: "bg-emerald-500/20",
  },
  {
    label:      "text-rose-400",
    bid:        "bg-rose-500/15",
    headerBg:   "bg-rose-500/[0.05]",
    borderLeft: "border-l-rose-500/50",
    spreadLine: "bg-rose-500/20",
  },
  {
    label:      "text-blue-400",
    bid:        "bg-blue-500/15",
    headerBg:   "bg-blue-500/[0.05]",
    borderLeft: "border-l-blue-500/50",
    spreadLine: "bg-blue-500/20",
  },
  {
    label:      "text-violet-400",
    bid:        "bg-violet-500/15",
    headerBg:   "bg-violet-500/[0.05]",
    borderLeft: "border-l-violet-500/50",
    spreadLine: "bg-violet-500/20",
  },
  {
    label:      "text-amber-400",
    bid:        "bg-amber-500/15",
    headerBg:   "bg-amber-500/[0.05]",
    borderLeft: "border-l-amber-500/50",
    spreadLine: "bg-amber-500/20",
  },
]

const ASK_BAR = "bg-rose-500/8"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Level {
  priceCents: number
  priceExact: number
  amount: number
}

interface Book {
  label: string
  asks: Level[]
  bids: Level[]
  spread: number | null
  midPrice: number | null
  palette: Palette
  hasOrders: boolean
}

// ── Data processing ───────────────────────────────────────────────────────────

function buildBook(
  orders: Order[],
  wrapper: `0x${string}` | null,
  label: string,
  palette: Palette,
): Book {
  const empty = { label, asks: [], bids: [], spread: null, midPrice: null, palette, hasOrders: false }
  if (!wrapper) return empty

  const wLC = wrapper.toLowerCase()

  const askOrders = orders.filter(
    o => o.makerToken.toLowerCase() === wLC && o.takerToken.toLowerCase() === TAB,
  )
  const bidOrders = orders.filter(
    o => o.makerToken.toLowerCase() === TAB && o.takerToken.toLowerCase() === wLC,
  )

  function aggregate(
    raw: Order[],
    priceOf: (o: Order) => number,
    amtOf: (o: Order) => number,
    asc: boolean,
  ): Level[] {
    const map = new Map<number, { priceExact: number; amount: number }>()
    for (const o of raw) {
      const p = priceOf(o)
      const pc = Math.round(p * 100)
      const a = amtOf(o)
      const ex = map.get(pc)
      if (ex) ex.amount += a
      else map.set(pc, { priceExact: p, amount: a })
    }
    return [...map.entries()]
      .map(([pc, { priceExact, amount }]) => ({ priceCents: pc, priceExact, amount }))
      .sort((a, b) => asc ? a.priceCents - b.priceCents : b.priceCents - a.priceCents)
  }

  const asks = aggregate(
    askOrders,
    o => Number(o.takerAmount) / Number(o.makerAmount),
    o => Number(o.makerAmount) / 1e18,
    true,
  )
  const bids = aggregate(
    bidOrders,
    o => Number(o.makerAmount) / Number(o.takerAmount),
    o => Number(o.takerAmount) / 1e18,
    false,
  )

  const bestAsk = asks[0]?.priceExact ?? null
  const bestBid = bids[0]?.priceExact ?? null
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null
  const midPrice =
    bestAsk !== null && bestBid !== null
      ? (bestAsk + bestBid) / 2
      : bestAsk ?? bestBid ?? null

  return { label, asks, bids, spread, midPrice, palette, hasOrders: asks.length > 0 || bids.length > 0 }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BookSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-px border border-border bg-border animate-pulse overflow-hidden">
      {Array.from({ length: count }).map((_, c) => (
        <div key={c} className="flex flex-col gap-px bg-card p-3">
          <div className="mb-2 h-3 w-8 bg-muted" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[18px] bg-muted/60" style={{ width: `${80 - i * 14}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Level row ─────────────────────────────────────────────────────────────────

function LevelRow({
  level,
  maxAmt,
  side,
  barClass,
  palette,
}: {
  level: Level
  maxAmt: number
  side: "ask" | "bid"
  barClass: string
  palette: Palette
}) {
  const depthPct = maxAmt > 0 ? (level.amount / maxAmt) * 100 : 0
  // asks are always rose; bids inherit the outcome color (green for YES, rose for NO)
  const priceColor = side === "ask" ? "text-rose-400" : palette.label

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 px-3 py-[3px]",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.04]",
        "transition-colors duration-75",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0",
          "transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          barClass,
        )}
        style={{ width: `${depthPct}%` }}
      />
      <span
        className={cn(
          "relative w-6 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums",
          priceColor,
        )}
      >
        {level.priceCents}
      </span>
      <span className="relative flex-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground/60">
        {level.amount < 10 ? level.amount.toFixed(2) : level.amount.toFixed(1)}
      </span>
    </div>
  )
}

// ── Shared spread row (binary / scalar only) ──────────────────────────────────

function SharedSpreadRow({ left, right }: { left: Book; right: Book }) {
  const lSpread = left.spread  !== null ? `${Math.round(left.spread  * 100)}¢` : "—"
  const rSpread = right.spread !== null ? `${Math.round(right.spread * 100)}¢` : "—"

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/10 border-y border-border/60">
      {/* YES spread value + colored line */}
      <span className={cn("font-mono text-[9px] tabular-nums w-5 text-right shrink-0", left.palette.label, "opacity-50")}>
        {lSpread}
      </span>
      <div className={cn("h-px flex-1", left.palette.spreadLine)} />
      <span className="text-[7px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40 shrink-0">
        spread
      </span>
      <div className={cn("h-px flex-1", right.palette.spreadLine)} />
      <span className={cn("font-mono text-[9px] tabular-nums w-5 shrink-0", right.palette.label, "opacity-50")}>
        {rSpread}
      </span>
    </div>
  )
}

// ── Outcome block ─────────────────────────────────────────────────────────────

function OutcomeBlock({
  book,
  showSpread,
}: {
  book: Book
  showSpread: boolean  // false when spread is shared externally
}) {
  const { label, asks, bids, spread, midPrice, palette, hasOrders } = book

  const visAsks = asks.slice(-MAX_ROWS).reverse()
  const visBids = bids.slice(0, MAX_ROWS)
  const maxAmt = Math.max(0, ...[...visAsks, ...visBids].map(l => l.amount))

  return (
    <div className={cn("flex flex-col min-w-0 bg-card border-l-2", palette.borderLeft)}>

      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2.5 border-b border-border",
        palette.headerBg,
      )}>
        <span className={cn("font-mono text-[10px] font-bold tracking-widest uppercase", palette.label)}>
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/30">mid</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
            {midPrice !== null ? `${Math.round(midPrice * 100)}¢` : "—"}
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-[3px] border-b border-border/30">
        <span className="w-6 shrink-0 text-right text-[9px] uppercase tracking-widest text-muted-foreground/25">¢</span>
        <span className="flex-1 text-right text-[9px] uppercase tracking-widest text-muted-foreground/25">qty</span>
      </div>

      {!hasOrders ? (
        <div className="flex items-center justify-center py-5">
          <span className="text-[10px] text-muted-foreground/25">No orders</span>
        </div>
      ) : (
        <>
          {/* Asks: high → low (best ask nearest spread, at bottom) */}
          <div className="flex flex-col">
            {visAsks.length === 0 ? (
              <div className="px-3 py-2">
                <span className="text-[9px] text-muted-foreground/20">No asks</span>
              </div>
            ) : (
              visAsks.map(l => (
                <LevelRow key={l.priceCents} level={l} maxAmt={maxAmt} side="ask" barClass={ASK_BAR} palette={palette} />
              ))
            )}
          </div>

          {/* Per-outcome spread (only for multi-outcome markets where no shared spread exists) */}
          {showSpread && (
            <div className={cn(
              "flex items-center justify-between px-3 py-1.5 border-y border-border/50",
              palette.headerBg,
            )}>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground/30">Spread</span>
              <span className={cn("font-mono text-[10px] tabular-nums font-medium opacity-60", palette.label)}>
                {spread !== null ? `${Math.round(spread * 100)}¢` : "—"}
              </span>
            </div>
          )}

          {/* Thin ask/bid separator when using shared spread */}
          {!showSpread && <div className="h-px bg-border/40" />}

          {/* Bids: best bid nearest spread (at top) */}
          <div className="flex flex-col">
            {visBids.length === 0 ? (
              <div className="px-3 py-2">
                <span className="text-[9px] text-muted-foreground/20">No bids</span>
              </div>
            ) : (
              visBids.map(l => (
                <LevelRow key={l.priceCents} level={l} maxAmt={maxAmt} side="bid" barClass={palette.bid} palette={palette} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  market: Market
}

export function OrderBook({ market }: Props) {
  const slots = useMemo(() => getOutcomeSlots(market), [market])
  const conditionId = market.conditionId as `0x${string}`

  const { data: orders = [], isLoading: oLoading } = useOrders(
    market.marketId != null ? { marketId: market.marketId } : undefined,
  )

  const { data: wrapperData, isLoading: wLoading } = useReadContracts({
    contracts: slots.map(({ indexSet }) => ({
      address: POSITION_WRAPPER_FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getWrapper" as const,
      args: [TABCOIN_ADDRESS, conditionId, indexSet] as const,
    })),
    query: { staleTime: 30_000 },
  })

  const books = useMemo(
    () =>
      slots.map((slot, i) => {
        const raw = wrapperData?.[i]?.result as `0x${string}` | undefined
        const wrapper = raw && BigInt(raw) !== 0n ? raw : null
        return buildBook(orders, wrapper, slot.label, PALETTES[i % PALETTES.length])
      }),
    [orders, wrapperData, slots],
  )

  if (oLoading || wLoading) return <BookSkeleton count={slots.length} />

  // Binary/scalar: 2 outcomes → shared spread between them
  const isBinary = books.length === 2

  return (
    <div className="flex flex-col gap-px border border-border bg-border overflow-hidden">
      {isBinary ? (
        <>
          <OutcomeBlock book={books[0]} showSpread={false} />
          <SharedSpreadRow left={books[0]} right={books[1]} />
          <OutcomeBlock book={books[1]} showSpread={false} />
        </>
      ) : (
        books.map(book => (
          <OutcomeBlock key={book.label} book={book} showSpread={true} />
        ))
      )}
    </div>
  )
}