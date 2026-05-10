import { motion } from "motion/react"
import { Search } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { CreateMarketDialog } from "@/features/market/components/create-market-dialog"
import { CreateDiceMarketDialog } from "@/features/dice/components/create-dice-market-dialog"

interface Props {
  /** Show the search trigger button when provided. Omit on detail pages. */
  onSearch?: () => void
}

/**
 * Shared right-hand control cluster used by the Markets list, the Dice list,
 * and the corresponding detail pages. The two dialog buttons carry layoutIds
 * so motion animates them between routes inside the root <LayoutGroup>.
 */
export function MarketsHeaderControls({ onSearch }: Props) {
  return (
    <div className="flex items-center gap-2">
      {onSearch && (
        <button
          onClick={onSearch}
          className={cn(
            "group flex items-center gap-2 border border-border bg-background px-2.5 py-1.5 text-xs",
            "transition-colors duration-150",
            "[@media(hover:hover)_and_(pointer:fine)]:hover:border-foreground/40",
            "active:scale-[0.98]",
          )}
          aria-label="Search markets"
        >
          <Search aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="hidden text-muted-foreground sm:inline">Search markets</span>
          <kbd className="hidden border border-border bg-muted/40 px-1 py-px font-mono text-[9px] text-muted-foreground/70 sm:inline">
            ⌘K
          </kbd>
        </button>
      )}

      <motion.div
        layout
        layoutId="cosmic-dice-button"
        transition={{ type: "spring", duration: 0.4, bounce: 0 }}
      >
        <CreateDiceMarketDialog />
      </motion.div>

      <motion.div
        layout
        layoutId="add-market-button"
        transition={{ type: "spring", duration: 0.4, bounce: 0 }}
      >
        <CreateMarketDialog />
      </motion.div>
    </div>
  )
}
