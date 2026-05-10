import type { Market } from "@/features/market/types"
import { CreatePoolForm } from "./create-pool-form"
import { PoolStatsCard } from "./pool-stats-card"
import { AddLiquidityForm } from "./add-liquidity-form"
import { RemoveLiquidityForm } from "./remove-liquidity-form"
import type { PoolData, UserPoolData } from "./use-amm-pool"

interface Props {
  market: Market
  marketId: number
  pool: PoolData | null
  user: UserPoolData
  totalReserveTab: bigint
  tabBalanceNum: number
}

export function LiquiditySubTab({
  market,
  marketId,
  pool,
  user,
  totalReserveTab,
  tabBalanceNum,
}: Props) {
  if (!pool) {
    return <CreatePoolForm marketId={marketId} tabBalanceNum={tabBalanceNum} />
  }
  return (
    <div className="flex flex-col gap-3">
      <PoolStatsCard
        market={market}
        pool={pool}
        user={user}
        totalReserveTab={totalReserveTab}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AddLiquidityForm marketId={marketId} tabBalanceNum={tabBalanceNum} />
        <RemoveLiquidityForm
          market={market}
          marketId={marketId}
          pool={pool}
          user={user}
        />
      </div>
    </div>
  )
}
