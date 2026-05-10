import { Link } from "@tanstack/react-router"
import { useAccount, useReadContracts } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { formatBalance } from "@/features/positions/lib/utils"
import { useClaimWinnings, type ClaimablePosition } from "@/features/market/hooks/use-claim-winnings"
import {
  CONDITIONAL_TOKENS_ADDRESS,
  CONDITIONAL_TOKENS_ABI,
} from "@/lib/contracts"
import type { Position } from "@/features/positions/hooks/use-positions"
import type { Market, MarketCategory } from "@/features/market/types"

const CATEGORY_BADGE: Record<MarketCategory, string> = {
  Finance:  "bg-amber-500/10  text-amber-400",
  Politics: "bg-blue-500/10   text-blue-400",
  Sport:    "bg-emerald-500/10 text-emerald-400",
  Czech:    "bg-purple-500/10 text-purple-400",
  Weather:  "bg-cyan-500/10   text-cyan-400",
}

const STATUS_BADGE: Record<string, string> = {
  open:      "border-emerald-500/30 text-emerald-400",
  pending:   "border-amber-500/30   text-amber-400",
  resolved:  "border-border         text-muted-foreground",
  cancelled: "border-rose-500/30    text-rose-400",
}

const POSITIVE_OUTCOMES = new Set(["YES", "Higher"])

// For singleton indexSets (1n, 2n, 4n, …) returns the corresponding outcome array index
function indexSetToOutcomeIndex(indexSet: bigint): number {
  let n = indexSet
  let i = 0
  while (n > 1n) { n >>= 1n; i++ }
  return i
}

function outcomeCount(market: Market): number {
  return market.outcomeType === "multi" ? market.outcomes.length : 2
}

interface MarketPositionCardProps {
  market: Market
  positions: Position[]
}

export function MarketPositionCard({ market, positions }: MarketPositionCardProps) {
  const { address } = useAccount()
  const { claimWinnings, isPending } = useClaimWinnings()
  const isResolved = market.status === "resolved"
  const count = outcomeCount(market)

  // Payout numerators — only needed for resolved markets
  const { data: payoutData } = useReadContracts({
    contracts: isResolved
      ? Array.from({ length: count }, (_, i) => ({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "payoutNumerators" as const,
          args: [market.conditionId as `0x${string}`, BigInt(i)] as const,
        }))
      : [],
    query: { enabled: isResolved },
  })

  const payouts: bigint[] = payoutData?.map(d => (d?.result ?? 0n) as bigint) ?? []
  const payoutsReady = isResolved && payouts.length === count

  // Positions where: resolved + payout > 0 + any tokens (raw OR wrapped) → claimable
  const claimablePositions: ClaimablePosition[] = payoutsReady
    ? positions
        .filter(p => {
          const idx = indexSetToOutcomeIndex(p.indexSet)
          return (p.balance > 0n || p.wrappedBalance > 0n) && (payouts[idx] ?? 0n) > 0n
        })
        .map(p => ({
          indexSet: p.indexSet,
          wrapperAddress: p.wrapperAddress,
          wrappedBalance: p.wrappedBalance,
        }))
    : []

  const hasClaimable = claimablePositions.length > 0

  function handleClaim() {
    claimWinnings(market, claimablePositions)
  }

  return (
    <div className="border border-border">
      {/* Market header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <span className={cn(
          "shrink-0 px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase",
          CATEGORY_BADGE[market.category],
        )}>
          {market.category}
        </span>

        <Link
          to="/markets/$marketId"
          params={{ marketId: market.id }}
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground hover:underline underline-offset-2"
        >
          {market.title}
        </Link>

        <span className={cn(
          "shrink-0 border px-1.5 py-0.5 text-[9px] uppercase tracking-widest",
          STATUS_BADGE[market.status] ?? "border-border text-muted-foreground",
        )}>
          {market.status}
        </span>

        {/* Claim button — only for resolved markets with claimable positions */}
        {isResolved && address && (
          <Button
            size="sm"
            variant={hasClaimable ? "default" : "outline"}
            disabled={!hasClaimable || isPending || !payoutsReady}
            onClick={handleClaim}
            className="shrink-0 h-6 px-2 text-[10px] uppercase tracking-widest"
          >
            {isPending
              ? "Claiming…"
              : hasClaimable
                ? "Claim"
                : "Claimed"}
          </Button>
        )}
      </div>

      {/* Column header */}
      <div className="flex items-center gap-3 px-3 py-1 border-b border-border">
        <span className="w-16 shrink-0" />
        <span className="flex-1 text-[9px] uppercase tracking-widest text-muted-foreground">
          Raw tokens
        </span>
        <span className="w-28 shrink-0 text-right text-[9px] uppercase tracking-widest text-muted-foreground">
          Wrapped ERC-20
        </span>
        {isResolved && (
          <span className="w-12 shrink-0 text-right text-[9px] uppercase tracking-widest text-muted-foreground">
            Result
          </span>
        )}
      </div>

      {/* Outcome rows */}
      {positions.map(p => {
        const isPositive = POSITIVE_OUTCOMES.has(p.outcomeLabel)
        const hasWrapped = p.wrapperAddress !== null

        // Result badge for resolved markets
        let resultBadge: React.ReactNode = null
        if (payoutsReady) {
          const idx = indexSetToOutcomeIndex(p.indexSet)
          const won = (payouts[idx] ?? 0n) > 0n
          resultBadge = (
            <span className={cn(
              "shrink-0 w-12 text-right text-[10px] font-bold uppercase tracking-widest",
              won ? "text-emerald-400" : "text-rose-500/60",
            )}>
              {won ? "WIN" : "LOSS"}
            </span>
          )
        }

        return (
          <div
            key={p.outcomeLabel}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0"
          >
            <span className={cn(
              "shrink-0 w-16 text-center text-[10px] font-bold tracking-widest uppercase py-0.5",
              isPositive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-rose-500/10 text-rose-400",
            )}>
              {p.outcomeLabel}
            </span>

            {/* Raw (ERC-1155) balance */}
            <div className="flex-1">
              {p.balance > 0n ? (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {formatBalance(p.balance)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>

            {/* Wrapped ERC-20 balance */}
            <div className="w-28 shrink-0 text-right">
              {!hasWrapped ? (
                <span className="text-xs text-muted-foreground">no wrapper</span>
              ) : p.wrappedBalance > 0n ? (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {formatBalance(p.wrappedBalance)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>

            {/* WIN / LOSS */}
            {isResolved && resultBadge}
          </div>
        )
      })}
    </div>
  )
}