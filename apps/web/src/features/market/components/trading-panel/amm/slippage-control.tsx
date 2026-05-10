import { cn } from "@workspace/ui/lib/utils"

const PRESETS = [50, 100, 300] as const // bps → 0.5 %, 1 %, 3 %

interface Props {
  value: number // bps
  onChange: (bps: number) => void
}

export function SlippageControl({ value, onChange }: Props) {
  const isCustom = !PRESETS.includes(value as (typeof PRESETS)[number])
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        Slippage
      </span>
      <div className="flex items-center gap-1">
        {PRESETS.map((bps) => {
          const active = value === bps
          return (
            <button
              key={bps}
              type="button"
              onClick={() => onChange(bps)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors duration-100",
                "border border-border/50",
                active
                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground hover:border-border",
              )}
            >
              {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
            </button>
          )
        })}
        <input
          type="number"
          min={0}
          max={50}
          step={0.1}
          value={isCustom ? (value / 100).toString() : ""}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v) && v >= 0) onChange(Math.round(v * 100))
          }}
          placeholder="…"
          className={cn(
            "w-12 border bg-transparent px-1 py-0.5 text-[10px] font-bold tabular-nums",
            "border-border/50 text-foreground placeholder:text-muted-foreground/40",
            "focus:outline-none focus:border-foreground/40",
            isCustom && "border-foreground/40 bg-foreground/10",
          )}
          aria-label="Custom slippage in percent"
        />
        <span className="text-[10px] text-muted-foreground/40">%</span>
      </div>
    </div>
  )
}
