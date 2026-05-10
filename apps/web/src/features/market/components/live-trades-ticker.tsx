import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"

// Mock live trades. Generated client-side for demo purposes — replaces the empty
// space below the chart with a sense of activity. Replace with WS feed later.

interface Trade {
  id: number
  side: "buy" | "sell"
  outcome: string
  tokens: number
  price: number
  taker: string
  ts: number
}

const ADDRS = [
  "0x4f2…b1e",
  "0x9a8…c0d",
  "0x6c1…f37",
  "0x2dd…a44",
  "0x8e0…219",
  "0xb71…05c",
  "0x3a5…d92",
  "0x71f…e83",
]

function pickOutcomes(m: Market): string[] {
  if (m.outcomeType === "binary") return ["YES", "NO"]
  if (m.outcomeType === "multi") return m.outcomes.map((o) => o.label)
  return ["HIGHER", "LOWER"]
}

function pickPrice(m: Market, outcome: string): number {
  if (m.outcomeType === "binary") {
    return outcome === "YES" ? m.yesPrice / 100 : m.noPrice / 100
  }
  if (m.outcomeType === "multi") {
    const o = m.outcomes.find((o) => o.label === outcome)
    return (o?.price ?? 50) / 100
  }
  const range = m.scalarMax - m.scalarMin
  const norm = range === 0 ? 0.5 : (m.currentValue - m.scalarMin) / range
  return outcome === "HIGHER" ? norm : 1 - norm
}

function fmtAgo(now: number, ts: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function makeTrade(idCounter: number, m: Market): Trade {
  const outcomes = pickOutcomes(m)
  const outcome = outcomes[Math.floor(Math.random() * outcomes.length)]!
  const side: "buy" | "sell" = Math.random() < 0.62 ? "buy" : "sell"
  const basePrice = pickPrice(m, outcome)
  const jitter = (Math.random() - 0.5) * 0.015
  const price = Math.max(0.02, Math.min(0.98, basePrice + jitter))
  const tokens = Math.round((10 + Math.random() * 220) * 10) / 10
  const taker = ADDRS[Math.floor(Math.random() * ADDRS.length)]!
  return { id: idCounter, side, outcome, tokens, price, taker, ts: Date.now() }
}

const MAX_VISIBLE = 4
const ROW_H = 36 // px — fixed height per row so the container never reflows

export function LiveTradesTicker({ market }: { market: Market }) {
  const [trades, setTrades] = useState<Trade[]>([])
  const idRef = useRef(0)
  const [, setTick] = useState(0)

  // Seed with a few trades so it doesn't look empty on first paint.
  useEffect(() => {
    const seeded: Trade[] = []
    const now = Date.now()
    for (let i = 0; i < MAX_VISIBLE; i++) {
      const t = makeTrade(idRef.current++, market)
      t.ts = now - (MAX_VISIBLE - i) * 4500
      seeded.push(t)
    }
    setTrades(seeded.reverse())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.id])

  // New trade every 3.5–6.5s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const delay = 3500 + Math.random() * 3000
      timer = setTimeout(() => {
        setTrades((prev) => {
          const next = [makeTrade(idRef.current++, market), ...prev]
          return next.slice(0, MAX_VISIBLE)
        })
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [market])

  // Re-render once a second to update relative timestamps.
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(i)
  }, [])

  const now = Date.now()
  const isBinaryOrScalar = useMemo(
    () => market.outcomeType !== "multi",
    [market.outcomeType]
  )

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          Live trades
        </h2>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40">
          last {trades.length}
        </span>
      </div>

      <div
        className="relative overflow-hidden border border-border/60 bg-card/30"
        style={{ height: MAX_VISIBLE * ROW_H }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {trades.map((t) => {
            const tabAmount = t.tokens * t.price
            return (
              <motion.div
                key={t.id}
                layout="position"
                initial={{
                  opacity: 0,
                  y: -ROW_H * 0.4,
                  backgroundColor:
                    t.side === "buy"
                      ? "rgba(56,189,248,0.10)"
                      : "rgba(249,115,22,0.10)",
                }}
                animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
                exit={{ opacity: 0 }}
                transition={{
                  opacity: { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
                  y: { type: "spring", stiffness: 260, damping: 32, mass: 0.7 },
                  backgroundColor: { duration: 1.6, ease: "easeOut" },
                  layout: { type: "spring", stiffness: 260, damping: 32, mass: 0.7 },
                }}
                style={{ height: ROW_H }}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-3 text-xs"
              >
                <span
                  className={cn(
                    "min-w-[34px] text-center text-[9px] font-bold uppercase tracking-widest",
                    t.side === "buy" ? "text-sky-400" : "text-orange-400"
                  )}
                >
                  {t.side}
                </span>

                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-semibold tabular-nums text-foreground/95",
                      isBinaryOrScalar && t.outcome === "NO" && "text-rose-300",
                      isBinaryOrScalar && t.outcome === "YES" && "text-emerald-300",
                      isBinaryOrScalar && t.outcome === "LOWER" && "text-rose-300",
                      isBinaryOrScalar && t.outcome === "HIGHER" && "text-emerald-300",
                    )}
                  >
                    {t.tokens.toFixed(1)}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                    {t.outcome}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">@</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                    {t.price.toFixed(3)}
                  </span>
                </span>

                <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
                  {tabAmount.toFixed(1)} TAB
                </span>

                <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground/40">
                  <span className="font-mono">{t.taker}</span>
                  <span className="hidden tabular-nums sm:inline">· {fmtAgo(now, t.ts)}</span>
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </section>
  )
}
