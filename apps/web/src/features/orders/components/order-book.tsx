import { useMemo } from "react"
import { useReadContracts } from "wagmi"
import { hashTypedData } from "viem"
import { cn } from "@workspace/ui/lib/utils"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import {
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
  TABCLOB_ADDRESS,
  TABCLOB_ABI,
} from "@/lib/contracts"
import { useOutcomeSelection } from "@/store/outcome-selection"
import type { Market } from "@/features/market/types"
import type { Order } from "@/features/orders/types"

// ── Constants ─────────────────────────────────────────────────────────────────

const TAB = TABCOIN_ADDRESS.toLowerCase()
const MAX_ROWS = 5
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

const ORDER_EIP712_TYPES = {
  Order: [
    { name: "maker",       type: "address" },
    { name: "taker",       type: "address" },
    { name: "makerToken",  type: "address" },
    { name: "takerToken",  type: "address" },
    { name: "makerAmount", type: "uint128" },
    { name: "takerAmount", type: "uint128" },
    { name: "expiry",      type: "uint64"  },
    { name: "salt",        type: "uint256" },
    { name: "marketId",    type: "uint256" },
  ],
} as const

// ── Palettes ──────────────────────────────────────────────────────────────────

interface Palette {
  label: string // text color for outcome label and bid prices
  bid: string // bid depth bar bg
  headerBg: string // section tint bg
  spreadLine: string // right half of spread divider
  tabActive: string // tab active state (bg + text + ring)
}

const BINARY_PALETTES: Palette[] = [
  {
    label: "text-emerald-400",
    bid: "bg-emerald-500/15",
    headerBg: "bg-emerald-500/[0.05]",
    spreadLine: "bg-emerald-500/20",
    tabActive: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25",
  },
  {
    label: "text-rose-400",
    bid: "bg-rose-500/15",
    headerBg: "bg-rose-500/[0.05]",
    spreadLine: "bg-rose-500/20",
    tabActive: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/25",
  },
]

const MULTI_PALETTES: Palette[] = [
  {
    label: "text-blue-400",
    bid: "bg-blue-500/15",
    headerBg: "bg-blue-500/[0.05]",
    spreadLine: "bg-blue-500/20",
    tabActive: "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/25",
  },
  {
    label: "text-violet-400",
    bid: "bg-violet-500/15",
    headerBg: "bg-violet-500/[0.05]",
    spreadLine: "bg-violet-500/20",
    tabActive: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/25",
  },
  {
    label: "text-amber-400",
    bid: "bg-amber-500/15",
    headerBg: "bg-amber-500/[0.05]",
    spreadLine: "bg-amber-500/20",
    tabActive: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25",
  },
  {
    label: "text-cyan-400",
    bid: "bg-cyan-500/15",
    headerBg: "bg-cyan-500/[0.05]",
    spreadLine: "bg-cyan-500/20",
    tabActive: "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25",
  },
]

const ASK_BAR = "bg-rose-500/[0.08]"
const BID_BAR = "bg-emerald-500/15"
const BID_HEADER_BG = "bg-emerald-500/[0.05]"
const BID_LABEL = "text-emerald-400"
const BID_SPREAD_LINE = "bg-emerald-500/20"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Level {
  priceCents: number // bucketing key (0–100)
  priceExact: number // 0–1 float for display
  amount: number
}

interface Book {
  label: string
  asks: Level[] // sorted ascending (low → high), best ask is asks[0]
  bids: Level[] // sorted descending (high → low), best bid is bids[0]
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
  palette: Palette
): Book {
  const empty = {
    label,
    asks: [],
    bids: [],
    spread: null,
    midPrice: null,
    palette,
    hasOrders: false,
  }
  if (!wrapper) return empty

  const wLC = wrapper.toLowerCase()

  const askOrders = orders.filter(
    (o) =>
      o.makerToken.toLowerCase() === wLC && o.takerToken.toLowerCase() === TAB
  )
  const bidOrders = orders.filter(
    (o) =>
      o.makerToken.toLowerCase() === TAB && o.takerToken.toLowerCase() === wLC
  )

  function aggregate(
    raw: Order[],
    priceOf: (o: Order) => number,
    amtOf: (o: Order) => number,
    asc: boolean
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
      .map(([pc, { priceExact, amount }]) => ({
        priceCents: pc,
        priceExact,
        amount,
      }))
      .sort((a, b) =>
        asc ? a.priceCents - b.priceCents : b.priceCents - a.priceCents
      )
  }

  const asks = aggregate(
    askOrders,
    (o) => Number(o.takerAmount) / Number(o.makerAmount),
    (o) => Number(o.makerAmount) / 1e18,
    true
  )
  const bids = aggregate(
    bidOrders,
    (o) => Number(o.makerAmount) / Number(o.takerAmount),
    (o) => Number(o.takerAmount) / 1e18,
    false
  )

  const bestAsk = asks[0]?.priceExact ?? null
  const bestBid = bids[0]?.priceExact ?? null
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null
  const midPrice =
    bestAsk !== null && bestBid !== null
      ? (bestAsk + bestBid) / 2
      : (bestAsk ?? bestBid ?? null)

  return {
    label,
    asks,
    bids,
    spread,
    midPrice,
    palette,
    hasOrders: asks.length > 0 || bids.length > 0,
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BookSkeleton() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden border border-border">
      {/* tabs */}
      <div className="flex gap-1 border-b border-border/40 p-1">
        <div className="h-7 flex-1 bg-muted/40" />
        <div className="h-7 flex-1 bg-muted/20" />
      </div>
      {/* rows */}
      {Array.from({ length: 11 }).map((_, i) => (
        <div
          key={i}
          className="mx-3 my-px h-[18px] bg-muted/30"
          style={{ width: `${Math.max(30, 95 - i * 6)}%` }}
        />
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
}: {
  level: Level
  maxAmt: number
  side: "ask" | "bid"
  barClass: string
}) {
  const depthPct = maxAmt > 0 ? (level.amount / maxAmt) * 100 : 0
  const priceColor = side === "ask" ? "text-rose-400" : "text-emerald-400"

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 px-3 py-[3px]",
        "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.04]",
        "transition-colors duration-75"
      )}
    >
      {/* depth bar (fills from left) */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0",
          "transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          barClass
        )}
        style={{ width: `${depthPct}%` }}
      />
      {/* spacer — pushes fixed columns to the right, matching header */}
      <div className="flex-1" />
      {/* price (0–1) */}
      <span
        className={cn(
          "relative w-12 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums",
          priceColor
        )}
      >
        {level.priceExact.toFixed(3)}
      </span>
      {/* shares */}
      <span className="relative w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground/60 tabular-nums">
        {level.amount < 10 ? level.amount.toFixed(2) : level.amount.toFixed(1)}
      </span>
      {/* total (TAB) */}
      <span className="relative w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground/40 tabular-nums">
        {(level.priceExact * level.amount).toFixed(1)}
      </span>
    </div>
  )
}

// ── Side tabs ─────────────────────────────────────────────────────────────────

function SideTabs({
  books,
  selectedIndex,
  onSelect,
}: {
  books: Book[]
  selectedIndex: number
  onSelect: (i: number) => void
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border/40 bg-muted/5 p-1">
      {books.map((book, i) => {
        const active = i === selectedIndex
        return (
          <button
            key={book.label}
            onClick={() => onSelect(i)}
            className={cn(
              "flex-1 px-3 py-1.5",
              "text-[11px] font-bold tracking-widest uppercase",
              "transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "active:scale-[0.97]",
              active
                ? book.palette.tabActive
                : "text-muted-foreground/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground"
            )}
          >
            {book.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Single book view ──────────────────────────────────────────────────────────

function SingleBookView({ book }: { book: Book }) {
  const { asks, bids, spread, hasOrders } = book

  // ASK display: high → low (highest at top, best/lowest ask nearest spread)
  const visAsks = asks.slice(-MAX_ROWS).reverse()
  // BID display: high → low (best/highest bid nearest spread, lowest at bottom)
  const visBids = bids.slice(0, MAX_ROWS)
  const maxAmt = Math.max(0, ...[...visAsks, ...visBids].map((l) => l.amount))

  return (
    <div className="flex flex-col">
      {/* Column headers */}
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-1.5">
        <div className="flex-1" />
        <span className="w-12 text-right text-[9px] tracking-widest text-muted-foreground/25 uppercase">
          Price
        </span>
        <span className="w-14 text-right text-[9px] tracking-widest text-muted-foreground/25 uppercase">
          Shares
        </span>
        <span className="w-14 text-right text-[9px] tracking-widest text-muted-foreground/25 uppercase">
          Total
        </span>
      </div>

      {!hasOrders ? (
        <div className="flex items-center justify-center py-10">
          <span className="text-[10px] text-muted-foreground/25">
            No orders
          </span>
        </div>
      ) : (
        <>
          {/* ASK section */}
          <div className="border-b border-border/20 bg-rose-500/[0.03] px-3 py-0.5">
            <span className="text-[9px] tracking-widest text-rose-400/40 uppercase">
              Ask
            </span>
          </div>

          <div className="flex flex-col">
            {visAsks.length === 0 ? (
              <div className="px-3 py-3 text-center">
                <span className="text-[9px] text-muted-foreground/20">
                  No asks
                </span>
              </div>
            ) : (
              visAsks.map((l) => (
                <LevelRow
                  key={l.priceCents}
                  level={l}
                  maxAmt={maxAmt}
                  side="ask"
                  barClass={ASK_BAR}
                />
              ))
            )}
          </div>

          {/* Spread */}
          <div className="flex items-center gap-2 border-y border-border/60 bg-muted/10 px-3 py-1.5">
            <div className="h-px flex-1 bg-rose-500/20" />
            <span className="shrink-0 text-[8px] font-semibold tracking-[0.18em] text-muted-foreground/40 uppercase">
              {spread !== null
                ? `spread ${(spread * 100).toFixed(1)}¢`
                : "spread —"}
            </span>
            <div className={cn("h-px flex-1", BID_SPREAD_LINE)} />
          </div>

          {/* BID section */}
          <div
            className={cn(
              "border-b border-border/20 px-3 py-0.5",
              BID_HEADER_BG
            )}
          >
            <span
              className={cn(
                "text-[9px] tracking-widest uppercase opacity-40",
                BID_LABEL
              )}
            >
              Bid
            </span>
          </div>

          <div className="flex flex-col">
            {visBids.length === 0 ? (
              <div className="px-3 py-3 text-center">
                <span className="text-[9px] text-muted-foreground/20">
                  No bids
                </span>
              </div>
            ) : (
              visBids.map((l) => (
                <LevelRow
                  key={l.priceCents}
                  level={l}
                  maxAmt={maxAmt}
                  side="bid"
                  barClass={BID_BAR}
                />
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

  const storeSlotIdx = useOutcomeSelection(s => s.slotIndices[market.id] ?? 0)
  const setSlotIndex = useOutcomeSelection(s => s.setSlotIndex)
  const selectedIndex = Math.max(0, Math.min(storeSlotIdx, slots.length - 1))

  const { data: orders = [], isLoading: oLoading } = useOrders(
    market.marketId != null ? { marketId: market.marketId } : undefined
  )

  // Compute EIP-712 order hashes client-side to query on-chain fill state
  const orderHashes = useMemo(() => orders.map(o => {
    if (!o.marketId) return ZERO_HASH
    try {
      return hashTypedData({
        domain: { name: "TabClob", version: "1", chainId: o.chainId, verifyingContract: TABCLOB_ADDRESS },
        types: ORDER_EIP712_TYPES,
        primaryType: "Order",
        message: {
          maker:       o.maker      as `0x${string}`,
          taker:       o.taker      as `0x${string}`,
          makerToken:  o.makerToken as `0x${string}`,
          takerToken:  o.takerToken as `0x${string}`,
          makerAmount: BigInt(o.makerAmount),
          takerAmount: BigInt(o.takerAmount),
          expiry:      BigInt(o.expiry),
          salt:        BigInt(o.salt),
          marketId:    BigInt(o.marketId),
        },
      }) as `0x${string}`
    } catch {
      return ZERO_HASH
    }
  }), [orders])

  // Read how much of each order's makerAmount has already been filled on-chain
  const { data: filledData, isLoading: fLoading } = useReadContracts({
    contracts: orderHashes.map(h => ({
      address: TABCLOB_ADDRESS,
      abi: TABCLOB_ABI,
      functionName: "filledMakerAmount" as const,
      args: [h] as const,
    })),
    query: { enabled: orders.length > 0, staleTime: 5_000 },
  })

  // Build effective orders: subtract filled amounts; drop fully-filled ones
  const effectiveOrders = useMemo(() => {
    if (!filledData) return orders
    return orders.flatMap((o, i) => {
      const filled = (filledData[i]?.result ?? 0n) as bigint
      const remaining = BigInt(o.makerAmount) - filled
      if (remaining <= 0n) return []
      if (remaining === BigInt(o.makerAmount)) return [o]
      const remainingTaker = (BigInt(o.takerAmount) * remaining) / BigInt(o.makerAmount)
      return [{ ...o, makerAmount: remaining.toString(), takerAmount: remainingTaker.toString() }]
    })
  }, [orders, filledData])

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
        const palette = (market.outcomeType === "binary" || market.outcomeType === "scalar")
          ? BINARY_PALETTES[i % 2]
          : MULTI_PALETTES[i % MULTI_PALETTES.length]
        return buildBook(effectiveOrders, wrapper, slot.label, palette)
      }),
    [effectiveOrders, wrapperData, slots]
  )

  if (oLoading || wLoading || fLoading) return <BookSkeleton />

  const selectedBook = books[Math.min(selectedIndex, books.length - 1)]

  return (
    <div className="flex flex-col overflow-hidden border border-border">
      {books.length > 1 && (
        <SideTabs
          books={books}
          selectedIndex={selectedIndex}
          onSelect={i => setSlotIndex(market.id, i)}
        />
      )}
      {selectedBook && <SingleBookView book={selectedBook} />}
    </div>
  )
}
