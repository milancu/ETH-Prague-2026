import { useState } from "react"
import { motion, LayoutGroup } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { slotPalette } from "../shared"
import { useAmmPool } from "./use-amm-pool"
import { LiquiditySubTab } from "./liquidity-sub-tab"
import { TradeSubTab } from "./trade-sub-tab"
import { outcomeLabels } from "./outcome-labels"

const SLIDE_SPRING = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.6 }

interface Props {
  market: Market
  tabBalanceNum: number
}

export function AmmPanel({ market, tabBalanceNum }: Props) {
  const marketId = market.marketId
  const [subTab, setSubTab] = useState<"liquidity" | "trade">("liquidity")
  const { pool, user, probabilities, totalReserveTab, isLoading } = useAmmPool(marketId)

  const labels = outcomeLabels(market)

  return (
    <LayoutGroup id="amm-sub-tabs">
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        {/* Implied probabilities header — present whenever a pool exists */}
        {pool && probabilities.length > 0 && (
          <div className="flex flex-col border border-border/60 bg-muted/10">
            <div className="border-b border-border/40 px-3 py-1">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                AMM Implied Probability
              </span>
            </div>
            <div className="flex">
              {probabilities.map((p, i) => {
                const palette = slotPalette(i, market)
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2",
                      "border-r border-border/40 last:border-r-0",
                    )}
                  >
                    <span className={cn("text-[9px] font-bold uppercase tracking-widest", palette.text)}>
                      {labels[i] ?? `#${i}`}
                    </span>
                    <span className={cn("font-mono text-base font-semibold tabular-nums", palette.text)}>
                      {(p * 100).toFixed(1)}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="relative grid grid-cols-2 gap-1 rounded-[2px] bg-muted/40 p-0.5">
          {(["liquidity", "trade"] as const).map((t) => {
            const active = subTab === t
            return (
              <button
                key={t}
                onClick={() => setSubTab(t)}
                aria-pressed={active}
                className={cn(
                  "relative py-1.5 text-[10px] font-bold uppercase tracking-widest",
                  "transition-colors duration-150 active:scale-[0.98]",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground/55 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground",
                )}
              >
                <span className="relative z-10">{t === "liquidity" ? "Liquidity" : "Trade"}</span>
                {active && (
                  <motion.span
                    layoutId="amm-sub-tab-pill"
                    aria-hidden
                    className="absolute inset-0 z-0 bg-foreground/10 ring-1 ring-foreground/20"
                    transition={SLIDE_SPRING}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Body */}
        {marketId == null ? (
          <div className="border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-[11px] text-muted-foreground/60">
            Market has no on-chain id yet.
          </div>
        ) : isLoading && !pool ? (
          <div className="border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-[11px] text-muted-foreground/60">
            Loading pool…
          </div>
        ) : subTab === "liquidity" ? (
          <LiquiditySubTab
            market={market}
            marketId={marketId}
            pool={pool}
            user={user}
            totalReserveTab={totalReserveTab}
            tabBalanceNum={tabBalanceNum}
          />
        ) : (
          <TradeSubTab
            market={market}
            marketId={marketId}
            pool={pool}
            tabBalanceNum={tabBalanceNum}
          />
        )}
      </div>
    </LayoutGroup>
  )
}
