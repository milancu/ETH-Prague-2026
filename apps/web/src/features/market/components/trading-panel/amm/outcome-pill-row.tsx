import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { slotPalette } from "../shared"
import { outcomeLabels } from "./outcome-labels"

interface Props {
  market: Market
  selected: number
  onSelect: (idx: number) => void
}

export function OutcomePillRow({ market, selected, onSelect }: Props) {
  const labels = outcomeLabels(market)
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label, idx) => {
        const palette = slotPalette(idx, market)
        const active = idx === selected
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelect(idx)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest",
              "border transition-colors duration-100 active:scale-[0.97]",
              active
                ? cn("border-current", palette.text, palette.activeBg, "ring-1", palette.ring)
                : cn("border-border/50 text-muted-foreground/60 hover:text-foreground hover:border-border"),
            )}
          >
            <span className={cn("size-1.5 rounded-full", active ? palette.dot : "bg-muted-foreground/40")} aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
}
