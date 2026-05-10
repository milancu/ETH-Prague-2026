import { Info } from "lucide-react"
import type { Market } from "@/features/market/types"
import { AmmBuyCard } from "./amm-buy-card"
import { AmmSellCard } from "./amm-sell-card"
import type { PoolData } from "./use-amm-pool"

interface Props {
  market: Market
  marketId: number
  pool: PoolData | null
  tabBalanceNum: number
}

export function TradeSubTab({ market, marketId, pool, tabBalanceNum }: Props) {
  if (!pool) {
    return (
      <div className="flex items-center gap-2 border border-dashed border-border/60 bg-muted/10 px-4 py-6">
        <Info className="size-3.5 shrink-0 text-muted-foreground/50" />
        <span className="text-[11px] text-muted-foreground/60">
          No liquidity pool exists for this market yet. Switch to the Liquidity sub-tab to create one.
        </span>
      </div>
    )
  }
  if (market.status !== "open") {
    return (
      <div className="flex items-center gap-2 border border-dashed border-border/60 bg-muted/10 px-4 py-6">
        <Info className="size-3.5 shrink-0 text-muted-foreground/50" />
        <span className="text-[11px] text-muted-foreground/60">
          Market is {market.status} — AMM trading is disabled.
        </span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <AmmBuyCard market={market} marketId={marketId} tabBalanceNum={tabBalanceNum} />
      <AmmSellCard market={market} marketId={marketId} pool={pool} />
    </div>
  )
}
