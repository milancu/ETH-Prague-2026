import { useReadContracts } from "wagmi"
import { CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI } from "@/lib/contracts"
import { getOutcomeSlots, getPositionId } from "@/features/positions/lib/utils"
import type { Market } from "@/features/market/types"

export interface Position {
  marketId: number
  marketTitle: string
  conditionId: string
  outcomeLabel: string
  positionId: bigint
  balance: bigint
}

export function usePositions(
  address: `0x${string}` | undefined,
  markets: Market[],
) {
  const slots = markets.flatMap(market =>
    getOutcomeSlots(market).map(({ label, indexSet }) => ({
      market,
      label,
      positionId: getPositionId(market.conditionId as `0x${string}`, indexSet),
    }))
  )

  const { data, isLoading } = useReadContracts({
    contracts: address
      ? slots.map(({ positionId }) => ({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "balanceOf" as const,
          args: [address, positionId] as const,
        }))
      : [],
    query: { enabled: !!address && slots.length > 0 },
  })

  const positions: Position[] = data
    ? slots
        .map((slot, i) => ({
          marketId: slot.market.marketId,
          marketTitle: slot.market.title,
          conditionId: slot.market.conditionId,
          outcomeLabel: slot.label,
          positionId: slot.positionId,
          balance: (data[i]?.result ?? 0n) as bigint,
        }))
        .filter(p => p.balance > 0n)
    : []

  return { positions, isLoading }
}