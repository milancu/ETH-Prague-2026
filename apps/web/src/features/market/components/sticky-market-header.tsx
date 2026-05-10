import { useMemo } from "react"
import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"

// Tiny seeded RNG to produce a sparkline that matches the chart's vibe without
// re-running the heavier chart pipeline.
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
  const r = m.scalarMax - m.scalarMin
  return r === 0 ? 0.5 : (m.currentValue - m.scalarMin) / r
}

function makeSpark(m: Market, n = 36): number[] {
  const target = resolveCurrentPrice(m)
  const rng = lcg(hashStr(`${m.id}::spark`))
  let p = rng() * 0.4 + 0.3
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const drift = (target - p) * (t * t * 0.6 + 0.04)
    const noise = (rng() - 0.5) * 0.05
    p = Math.max(0.04, Math.min(0.96, p + drift + noise))
    out.push(i === n - 1 ? target : p)
  }
  return out
}

function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return ""
  const stepX = w / (values.length - 1)
  let d = `M 0 ${(1 - values[0]!) * h}`
  for (let i = 1; i < values.length; i++) {
    const x0 = (i - 1) * stepX
    const x1 = i * stepX
    const y0 = (1 - values[i - 1]!) * h
    const y1 = (1 - values[i]!) * h
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`
  }
  return d
}

interface Props {
  market: Market
  visible: boolean
}

const W = 96
const H = 24

export function StickyMarketHeader({ market, visible }: Props) {
  const values = useMemo(() => makeSpark(market), [market])
  const current = values[values.length - 1]!
  const first = values[0]!
  const deltaPp = (current - first) * 100
  const isUp = deltaPp >= 0

  const linePath = useMemo(() => sparkPath(values, W, H), [values])
  const areaPath = useMemo(
    () => `${linePath} L ${W} ${H} L 0 ${H} Z`,
    [linePath]
  )

  const tone = isUp ? "#34d399" : "#fb7185"

  const outcomeLabel =
    market.outcomeType === "binary"
      ? "YES"
      : market.outcomeType === "multi"
        ? market.outcomes[0]?.label
        : "HIGHER"

  return (
    // Sticky wrapper inside MarketDetail — top:0 pins to ScrollArea top.
    // Animated height collapses to 0 when hidden so it costs no layout.
    <motion.div
      initial={false}
      animate={{
        height: visible ? 52 : 0,
        opacity: visible ? 1 : 0,
      }}
      transition={{
        height: { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
        opacity: { duration: 0.18, ease: "easeOut" },
      }}
      className={cn(
        "sticky top-0 z-40 overflow-hidden border-b border-border/70",
        "bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80",
      )}
      style={{ pointerEvents: visible ? "auto" : "none" }}
      aria-hidden={!visible}
    >
      <div className="flex h-[52px] items-center gap-3 px-4 sm:gap-4">
        {/* Left: title (truncated) */}
        <h2 className="min-w-0 flex-1 truncate font-serif text-base leading-none tracking-[-0.01em] text-foreground sm:text-lg">
          {market.title}
        </h2>

        {/* Middle: tiny sparkline — hidden on smallest screens */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="hidden h-6 w-24 shrink-0 sm:block"
          aria-hidden
        >
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#spark-fill)" />
          <path d={linePath} stroke={tone} strokeWidth="1.25" fill="none" />
          <circle
            cx={W}
            cy={(1 - current) * H}
            r="1.6"
            fill={tone}
          />
        </svg>

        {/* Right: live price + delta */}
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">
            {outcomeLabel}
          </span>
          <span className="font-serif text-lg leading-none tracking-[-0.01em] text-foreground tabular-nums">
            {(current * 100).toFixed(1)}%
          </span>
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              isUp ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {isUp ? "+" : ""}
            {deltaPp.toFixed(1)}pp
          </span>
        </div>
      </div>
    </motion.div>
  )
}
