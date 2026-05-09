import { cn } from "@workspace/ui/lib/utils"
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/animate-ui/primitives/base/progress"
import type { BinaryMarket, Market, MultiMarket, ScalarMarket } from "@/features/market/types"
import { BINARY_PALETTE, MULTI_PALETTE } from "./shared"

// ── Binary ────────────────────────────────────────────────────────────────────

function BinarySelector({ market, selected, onSelect }: {
  market: BinaryMarket
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  const sides = [
    { id: "yes", label: "YES", price: market.yesPrice, ...BINARY_PALETTE[0] },
    { id: "no",  label: "NO",  price: market.noPrice,  ...BINARY_PALETTE[1] },
  ] as const
  return (
    <div className="flex flex-col gap-1">
      {sides.map(({ id, label, price, activeBg, ring, bar, text }) => {
        const active = selected === id
        return (
          <button key={id} aria-pressed={active} onClick={() => onSelect(active ? null : id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
            )}
          >
            <span className={cn("w-7 shrink-0 text-[11px] font-bold tracking-widest", text)}>{label}</span>
            <Progress value={price} className="flex-1">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", bar)} />
              </ProgressTrack>
            </Progress>
            <span className={cn("w-10 shrink-0 text-right text-xs font-bold tabular-nums", text)}>{price}%</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Multi ─────────────────────────────────────────────────────────────────────

function MultiSelector({ market, catBar, selected, onSelect }: {
  market: MultiMarket
  catBar: string
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {market.outcomes.map((outcome, i) => {
        const active = selected === outcome.id
        const pal = MULTI_PALETTE[i % MULTI_PALETTE.length]
        return (
          <button key={outcome.id} aria-pressed={active} onClick={() => onSelect(active ? null : outcome.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? cn(pal.activeBg, "ring-1", pal.ring) : "bg-muted hover:bg-muted/60",
            )}
          >
            <Progress value={outcome.price} className="flex-1">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", catBar)} />
              </ProgressTrack>
            </Progress>
            <span className="shrink-0 text-xs font-medium text-foreground">{outcome.label}</span>
            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{outcome.price}%</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Scalar ────────────────────────────────────────────────────────────────────

function ScalarSelector({ market, selected, onSelect }: {
  market: ScalarMarket
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  const range = market.scalarMax - market.scalarMin
  const pct = range === 0 ? 0 : ((market.currentValue - market.scalarMin) / range) * 100
  const sides = [
    { id: "higher", label: "HIGHER", hint: `> ${market.currentValue} ${market.scalarUnit}`, ...BINARY_PALETTE[0] },
    { id: "lower",  label: "LOWER",  hint: `< ${market.currentValue} ${market.scalarUnit}`, ...BINARY_PALETTE[1] },
  ] as const
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="uppercase tracking-widest text-muted-foreground">Consensus</span>
          <span className="font-semibold tabular-nums text-foreground">{market.currentValue} {market.scalarUnit}</span>
        </div>
        <Progress value={pct}>
          <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
            <ProgressIndicator className="h-full bg-primary/70" />
          </ProgressTrack>
        </Progress>
      </div>
      <div className="flex flex-col gap-1">
        {sides.map(({ id, label, hint, activeBg, ring, text }) => {
          const active = selected === id
          return (
            <button key={id} aria-pressed={active} onClick={() => onSelect(active ? null : id)}
              className={cn(
                "flex items-center justify-between px-3 py-2",
                "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
              )}
            >
              <span className={cn("text-[11px] font-bold tracking-widest", text)}>{label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Unified selector ──────────────────────────────────────────────────────────

export function OutcomeSelector({ market, catBar, selected, onSelect }: {
  market: Market
  catBar: string
  selected: string | null
  onSelect: (v: string | null) => void
}) {
  if (market.outcomeType === "binary")  return <BinarySelector  market={market} selected={selected} onSelect={onSelect} />
  if (market.outcomeType === "multi")   return <MultiSelector   market={market} catBar={catBar} selected={selected} onSelect={onSelect} />
  if (market.outcomeType === "scalar")  return <ScalarSelector  market={market} selected={selected} onSelect={onSelect} />
  return null
}