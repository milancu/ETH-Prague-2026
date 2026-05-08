import { useAccount } from "wagmi"
import { useMarkets } from "@/features/market/hooks/use-markets"
import { usePositions } from "@/features/positions/hooks/use-positions"
import { PositionRow } from "@/features/positions/components/position-row"

export function MyPositions() {
  const { address, isConnected } = useAccount()
  const { data: page, isLoading: marketsLoading } = useMarkets()
  const { positions, isLoading: positionsLoading } = usePositions(
    address,
    page?.markets ?? [],
  )

  const isLoading = marketsLoading || positionsLoading

  if (!isConnected) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Connect your wallet to see your positions.
      </p>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 bg-muted" />
        ))}
      </div>
    )
  }

  if (positions.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No positions held.
      </p>
    )
  }

  return (
    <div className="flex flex-col border border-border">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-muted/30">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">Outcome</span>
        <span className="flex-1 text-[10px] uppercase tracking-widest text-muted-foreground">Market</span>
        <span className="text-right text-[10px] uppercase tracking-widest text-muted-foreground">Balance</span>
        <span className="w-10 shrink-0" />
      </div>
      {positions.map(position => (
        <PositionRow
          key={`${position.marketId}-${position.outcomeLabel}`}
          position={position}
        />
      ))}
    </div>
  )
}