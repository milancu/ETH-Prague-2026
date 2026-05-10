import { useMemo } from "react"
import { useAccount } from "wagmi"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { usePositions } from "@/features/positions/hooks/use-positions"
import { WalletOverview } from "@/features/positions/components/wallet-overview"
import { MarketPositionCard } from "@/features/positions/components/market-position-card"
import type { Market } from "@/features/market/types"
import type { Position } from "@/features/positions/hooks/use-positions"

function groupByMarket(positions: Position[]): { market: Market; positions: Position[] }[] {
  const map = new Map<string, { market: Market; positions: Position[] }>()
  for (const p of positions) {
    if (!map.has(p.market.id)) {
      map.set(p.market.id, { market: p.market, positions: [] })
    }
    map.get(p.market.id)!.positions.push(p)
  }
  return Array.from(map.values())
}

export function MyPositions() {
  const { address, isConnected } = useAccount()
  const { data: page, isLoading: marketsLoading } = useMarkets()
  const { positions, isLoading: positionsLoading } = usePositions(
    address,
    page?.markets ?? [],
  )

  const grouped = useMemo(() => groupByMarket(positions), [positions])
  const isLoading = marketsLoading || positionsLoading

  if (!isConnected) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Connect your wallet to see your positions.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {address && <WalletOverview address={address} />}

      {isLoading ? (
        <div className="flex flex-col gap-3 animate-pulse">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No positions held.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map(({ market, positions: ps }) => (
            <MarketPositionCard key={market.id} market={market} positions={ps} />
          ))}
        </div>
      )}
    </div>
  )
}