import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import {
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  Sparkles,
  Hourglass,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { MarketCommandPalette } from "@/features/market/components/market-command-palette"
import { MarketsHeaderControls } from "@/features/market/components/markets-header-controls"
import {
  listDiceRecords,
  type DiceLocalRecord,
} from "@/features/dice/lib/storage"

const DIE_ICONS: Record<number, LucideIcon> = {
  1: Dice1,
  2: Dice2,
  3: Dice3,
  4: Dice4,
  5: Dice5,
  6: Dice6,
}

type Phase = "awaiting" | "ready" | "resolved"

function phaseOf(rec: DiceLocalRecord, now: number): Phase {
  if (rec.result !== null) return "resolved"
  if (rec.estimatedRevealUnix <= now) return "ready"
  return "awaiting"
}

function formatRelative(rec: DiceLocalRecord, now: number): string {
  const diff = rec.estimatedRevealUnix - now
  if (diff <= 0) return "ready now"
  const m = Math.floor(diff / 60)
  const s = diff % 60
  return `in ${m}:${s.toString().padStart(2, "0")}`
}

export function DiceList() {
  // ── State ────────────────────────────────────────────────────────────────
  const { data } = useMarkets()
  const allMarkets = useMemo(() => data?.markets ?? [], [data])
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Tick every second so countdowns + phase transitions are live.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const records = useMemo(() => listDiceRecords(), [])

  // ── Cmd+K to open palette (mirrors MarketList) ───────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── Stats ────────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    let awaiting = 0
    let ready = 0
    let resolved = 0
    for (const rec of records) {
      const phase = phaseOf(rec, now)
      if (phase === "awaiting") awaiting++
      else if (phase === "ready") ready++
      else resolved++
    }
    return { total: records.length, awaiting, ready, resolved }
  }, [records, now])

  return (
    <div className="flex flex-col gap-6">
      {/* Header — same shape as MarketList */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-2">
          <motion.h1
            layoutId="dice-label"
            className="w-fit text-2xl font-semibold tracking-tight"
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          >
            Cosmic Dice
          </motion.h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="font-semibold text-foreground/85">{counts.total}</span>{" "}
              <span className="uppercase tracking-widest text-muted-foreground/60">total</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="font-semibold text-foreground/85">{counts.awaiting}</span>{" "}
              <span className="uppercase tracking-widest text-muted-foreground/60">awaiting</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="font-semibold text-purple-400">{counts.ready}</span>{" "}
              <span className="uppercase tracking-widest text-muted-foreground/60">ready</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="font-semibold text-emerald-400">{counts.resolved}</span>{" "}
              <span className="uppercase tracking-widest text-muted-foreground/60">resolved</span>
            </span>
          </p>
        </div>

        <MarketsHeaderControls onSearch={() => setPaletteOpen(true)} />
      </div>

      <MarketCommandPalette
        markets={allMarkets}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />

      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-3 border border-border bg-muted/10 p-10 text-center">
          <Sparkles className="size-6 text-purple-400" aria-hidden />
          <p className="text-sm text-foreground">No cosmic dice yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Create one above. The 6-sided outcome is locked to a future
            beacon block — nobody can predict it.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {records.map((rec) => {
            const phase = phaseOf(rec, now)
            const Icon = rec.result ? DIE_ICONS[rec.result] ?? Sparkles : null
            return (
              <li key={rec.commitmentId}>
                <Link
                  to="/dice/$commitmentId"
                  params={{ commitmentId: String(rec.commitmentId) }}
                  className={cn(
                    "group flex items-center gap-4 border border-border bg-background p-4",
                    "transition-colors duration-150 hover:border-foreground/40",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center border border-border",
                      phase === "resolved" && "bg-emerald-500/10 text-emerald-400",
                      phase === "ready" && "bg-purple-500/10 text-purple-400",
                      phase === "awaiting" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {Icon ? (
                      <Icon className="size-7" aria-hidden />
                    ) : phase === "ready" ? (
                      <Sparkles className="size-5 animate-pulse" aria-hidden />
                    ) : (
                      <Hourglass className="size-5" aria-hidden />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {rec.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      commitment #{rec.commitmentId}
                      {rec.marketId !== null && ` · market #${rec.marketId}`}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] uppercase tracking-widest",
                        phase === "resolved" && "text-emerald-400",
                        phase === "ready" && "text-purple-400",
                        phase === "awaiting" && "text-muted-foreground",
                      )}
                    >
                      {phase === "resolved" && (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3" aria-hidden />
                          rolled {rec.result}
                        </span>
                      )}
                      {phase === "ready" && "ready to reveal"}
                      {phase === "awaiting" && formatRelative(rec, now)}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
