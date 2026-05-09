import { useState, useRef, useMemo, useCallback } from "react"
import { motion, useSpring, useMotionTemplate } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import {
  Tooltip,
  TooltipTrigger,
  TooltipPanel,
} from "@/components/animate-ui/components/base/tooltip"
import type { Market } from "@/features/market/types"

// ── Emil Kowalski spring config ────────────────────────────────────────────────
const SPRING = { damping: 18 } as const
const SLOW_SPRING = { damping: 40 } as const

// ── Types ─────────────────────────────────────────────────────────────────────

type Timeframe = "1D" | "1W" | "1M" | "ALL"

interface ChartPoint {
  t: number       // 0–1 normalized x position
  price: number   // 0–1 probability
  volume: number  // 0–1 normalized
  date: Date
}

interface ChartEvent {
  offsetDays: number  // days before now
  label: string       // short label shown in tooltip header
  description: string
}

const CHART_EVENTS: ChartEvent[] = [
  { offsetDays: 78, label: "25% Tariffs Announced", description: "Trump announced 25% tariffs on European imports. Markets reacted with a sharp sell-off." },
  { offsetDays: 55, label: "Fed Holds Rates", description: "The Fed kept interest rates unchanged at 5.25%. Chair Powell: inflation is under control." },
  { offsetDays: 38, label: "Poll: +4 pp", description: "STEM poll: support for the leading candidate rose to 54%, up 4 points from last month." },
  { offsetDays: 17, label: "Primary Results", description: "Primary results: frontrunner leads with 52% of votes, second-place rival drops out." },
  { offsetDays: 4, label: "TV Debate", description: "Presidential debate: commentators rate the performance as decisive for the election outcome." },
]

// ── Deterministic mock data ────────────────────────────────────────────────────

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

function resolveCurrentPrice(m: Market): number {
  if (m.outcomeType === "binary") return m.yesPrice / 100
  if (m.outcomeType === "multi") return (m.outcomes[0]?.price ?? 50) / 100
  const range = m.scalarMax - m.scalarMin
  return range === 0 ? 0.5 : (m.currentValue - m.scalarMin) / range
}

const DURATIONS: Record<Timeframe, number> = {
  "1D": 24 * 3_600_000,
  "1W": 7 * 24 * 3_600_000,
  "1M": 30 * 24 * 3_600_000,
  "ALL": 90 * 24 * 3_600_000,
}
const COUNTS: Record<Timeframe, number> = { "1D": 48, "1W": 56, "1M": 60, "ALL": 80 }

function makeData(market: Market, tf: Timeframe): ChartPoint[] {
  const target = resolveCurrentPrice(market)
  const rng = lcg(hashStr(`${market.id}::${tf}`))
  const now = Date.now()
  const n = COUNTS[tf]
  const dur = DURATIONS[tf]

  let price = rng() * 0.4 + 0.3
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const drift = (target - price) * (t * t * 0.5 + 0.03)
    const noise = (rng() - 0.5) * 0.06
    price = Math.max(0.03, Math.min(0.97, price + drift + noise))
    return {
      t,
      price: i === n - 1 ? target : price,
      volume: Math.pow(rng(), 1.5),
      date: new Date(now - (1 - t) * dur),
    }
  })
}

// ── SVG coordinate helpers ─────────────────────────────────────────────────────

const SVG_W = 600
const SVG_H = 140
const SVG_PAD = 6

function svgY(p: number): number {
  return SVG_PAD + (1 - p) * (SVG_H - SVG_PAD * 2)
}

function cssPct(p: number): string {
  return `${(svgY(p) / SVG_H) * 100}%`
}

function pathLine(pts: ChartPoint[]): string {
  if (pts.length < 2) return ""
  let d = `M ${(pts[0].t * SVG_W).toFixed(1)} ${svgY(pts[0].price).toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (((pts[i - 1].t + pts[i].t) / 2) * SVG_W).toFixed(1)
    const y0 = svgY(pts[i - 1].price).toFixed(1)
    const y1 = svgY(pts[i].price).toFixed(1)
    const x1 = (pts[i].t * SVG_W).toFixed(1)
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`
  }
  return d
}

function pathArea(pts: ChartPoint[]): string {
  const l = pathLine(pts)
  return l ? `${l} L ${SVG_W} ${SVG_H} L 0 ${SVG_H} Z` : ""
}

function fmtLabel(d: Date, tf: Timeframe): string {
  return tf === "1D"
    ? d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MarketPriceChart({ market }: { market: Market }) {
  const [tf, setTf] = useState<Timeframe>("1W")
  const [hovering, setHovering] = useState(false)
  const [xPct, setXPct] = useState(100)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Emil Kowalski: two springs — fast while hovering, slow on release
  const clipSpring = useSpring(0, hovering ? SPRING : SLOW_SPRING)
  const clipPath = useMotionTemplate`inset(0px ${clipSpring}% 0px 0px)`

  const data = useMemo(() => makeData(market, tf), [market, tf])
  const line = useMemo(() => pathLine(data), [data])
  const area = useMemo(() => pathArea(data), [data])

  const visibleEvents = useMemo(() => {
    const now = Date.now()
    const dur = DURATIONS[tf]
    const rangeStart = now - dur
    return CHART_EVENTS.flatMap(ev => {
      const evMs = now - ev.offsetDays * 24 * 3_600_000
      if (evMs <= rangeStart || evMs >= now) return []
      return [{ ...ev, xPct: ((evMs - rangeStart) / dur) * 100 }]
    })
  }, [tf])

  const hovIdx = useMemo(
    () => hovering
      ? Math.min(data.length - 1, Math.max(0, Math.round((xPct / 100) * (data.length - 1))))
      : data.length - 1,
    [hovering, xPct, data.length],
  )

  const pt = data[hovIdx]!
  const last = data[data.length - 1]!
  const first = data[0]!
  const delta = last.price - first.price
  const isUp = delta >= 0

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current) return
    const { left, width } = containerRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100))
    setXPct(pct)
    // reveal colored layer left of cursor — right inset = 100 - cursor%
    clipSpring.set(100 - pct)
  }, [clipSpring])

  const onEnter = useCallback(() => {
    setHovering(true)
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const onLeave = useCallback(() => {
    setHovering(false)
    // reset to default beautiful state (full colored layer) after 1s
    timerRef.current = setTimeout(() => clipSpring.set(0), 1000)
  }, [clipSpring])

  const outcomeLabel = market.outcomeType === "binary" ? "YES" : market.outcomeType === "multi" ? market.outcomes[0]?.label : undefined

  return (
    <div className="flex flex-col gap-2">
      {/* Header row: price + delta + timeframe tabs */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {(pt.price * 100).toFixed(1)}%
            </span>
            <span className={cn(
              "text-xs font-medium tabular-nums transition-colors duration-100",
              hovering
                ? "text-muted-foreground/60"
                : isUp ? "text-emerald-400" : "text-rose-400",
            )}>
              {hovering
                ? fmtLabel(pt.date, tf)
                : `${isUp ? "+" : ""}${(delta * 100).toFixed(1)} pp`}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">
            {outcomeLabel ? `${outcomeLabel} pravděpodobnost` : "Pravděpodobnost"}
          </span>
        </div>

        {/* Timeframe selector */}
        <div className="flex">
          {(["1D", "1W", "1M", "ALL"] as const).map((t, i) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={cn(
                "relative px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors duration-100",
                "border border-border/50",
                i > 0 && "-ml-px",
                t === tf
                  ? "bg-foreground text-background border-foreground z-10"
                  : "text-muted-foreground/50 hover:text-foreground hover:z-10",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        className="relative h-[140px] cursor-crosshair select-none overflow-hidden"
        onPointerMove={onMove}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        {/* Dashed grid lines */}
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden
        >
          {[0.25, 0.5, 0.75].map(p => (
            <line
              key={p}
              x1={0} y1={svgY(p).toFixed(1)} x2={SVG_W} y2={svgY(p).toFixed(1)}
              stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 3"
              className="text-border/40"
            />
          ))}
        </svg>

        {/* Layer 1 — muted grey (always visible, shows through on the right when hovering) */}
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="chart-muted-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.08" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#chart-muted-fill)" className="text-foreground" />
          <path d={line} stroke="currentColor" strokeWidth="1.5" fill="none" className="text-foreground/18" />
        </svg>

        {/* Layer 2 — colored emerald (clipped to left of cursor, spring-animated) */}
        <motion.svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ clipPath }}
          aria-hidden
        >
          <defs>
            <linearGradient id="chart-emerald-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#chart-emerald-fill)" />
          <path d={line} stroke="#10b981" strokeWidth="1.5" fill="none" />
        </motion.svg>

        {/* Event markers */}
        {visibleEvents.map((ev, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${ev.xPct}%` }}
          >
            <div className="absolute inset-y-0 left-0 w-px border-l border-dashed border-amber-400/30" />
            <Tooltip>
              <TooltipTrigger
                className="pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 size-2.5 rotate-45 rounded-[2px] bg-amber-400/70 hover:bg-amber-400 transition-colors focus:outline-none"
                aria-label={ev.label}
              />
              <TooltipPanel
                side="top"
                className="w-[240px] !bg-zinc-900 !text-zinc-100 border border-zinc-700 !text-pretty"
              >
                <p className="text-[11px] font-semibold leading-tight">{ev.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug opacity-70">{ev.description}</p>
              </TooltipPanel>
            </Tooltip>
          </div>
        ))}

        {/* Y-axis percentage labels */}
        {[0.75, 0.5, 0.25].map(p => (
          <span
            key={p}
            className="absolute right-0 text-[9px] tabular-nums text-muted-foreground/30 pointer-events-none leading-none"
            style={{ top: cssPct(p), transform: "translateY(-50%)" }}
          >
            {(p * 100).toFixed(0)}%
          </span>
        ))}

        {/* Cursor crosshair line */}
        {hovering && (
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground/15 pointer-events-none"
            style={{ left: `${xPct}%` }}
          />
        )}

        {/* Cursor dot on the line */}
        {hovering && (
          <div
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400 border-2 border-background shadow-[0_0_0_3px_rgba(16,185,129,0.15)] pointer-events-none"
            style={{ left: `${pt.t * 100}%`, top: cssPct(pt.price) }}
          />
        )}

        {/* Live dot at the most recent price point (default state only) */}
        {!hovering && (
          <div
            className="absolute right-0 -translate-y-1/2 pointer-events-none"
            style={{ top: cssPct(last.price) }}
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
          </div>
        )}
      </div>

      {/* Volume bars */}
      <div className="h-7 flex items-end gap-[1px]">
        {data.map((p, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 min-w-0 transition-colors duration-75",
              hovering && i <= hovIdx ? "bg-emerald-500/30" : "bg-foreground/[0.07]",
            )}
            style={{ height: `${Math.max(5, p.volume * 100)}%` }}
          />
        ))}
      </div>

      {/* X-axis time labels */}
      <div className="flex justify-between text-[9px] tabular-nums text-muted-foreground/35">
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const idx = Math.round(t * (data.length - 1))
          const d = data[idx]
          return d ? <span key={t}>{fmtLabel(d.date, tf)}</span> : <span key={t} />
        })}
      </div>
    </div>
  )
}