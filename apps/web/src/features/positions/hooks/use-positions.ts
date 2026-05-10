import { useReadContracts } from "wagmi"
import { zeroAddress } from "viem"
import {
  CONDITIONAL_TOKENS_ADDRESS,
  CONDITIONAL_TOKENS_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  FACTORY_ABI,
  TABCOIN_ADDRESS,
  ERC20_ABI,
} from "@/lib/contracts"
import { getOutcomeSlots, getPositionId } from "@/features/positions/lib/utils"
import type { Market } from "@/features/market/types"

export interface Position {
  marketId: number
  market: Market
  marketTitle: string
  conditionId: string
  outcomeLabel: string
  indexSet: bigint
  positionId: bigint
  balance: bigint
  wrapperAddress: `0x${string}` | null
  wrappedBalance: bigint
}

export function usePositions(
  address: `0x${string}` | undefined,
  markets: Market[],
) {
  const slots = markets.flatMap(market =>
    getOutcomeSlots(market).map(({ label, indexSet }) => ({
      market,
      label,
      indexSet,
      positionId: getPositionId(market.conditionId as `0x${string}`, indexSet),
    }))
  )

  // Step 1: ERC-1155 raw balances (ConditionalTokens)
  const { data: rawBalances, isLoading: rawLoading } = useReadContracts({
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

  // Step 2: Wrapper addresses from PositionWrapperFactory
  const { data: wrapperAddrs, isLoading: wrappersLoading } = useReadContracts({
    contracts: slots.map(({ market, indexSet }) => ({
      address: POSITION_WRAPPER_FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getWrapper" as const,
      args: [TABCOIN_ADDRESS, market.conditionId as `0x${string}`, indexSet] as const,
    })),
    query: { enabled: slots.length > 0 },
  })

  // Step 3: ERC-20 balances on wrapper contracts (depends on step 2)
  // Slots where wrapper doesn't exist use zeroAddress — the call will revert and return undefined (treated as 0)
  const { data: wrappedBalances, isLoading: wrappedLoading } = useReadContracts({
    contracts: address && wrapperAddrs
      ? wrapperAddrs.map(r => {
          const w = r?.result as `0x${string}` | undefined
          return {
            address: (w && w !== zeroAddress ? w : zeroAddress) as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address] as const,
          }
        })
      : [],
    query: { enabled: !!address && !!wrapperAddrs && wrapperAddrs.length > 0 },
  })

  const positions: Position[] = slots.map((slot, i) => {
    const raw = (rawBalances?.[i]?.result ?? 0n) as bigint
    const wAddr = wrapperAddrs?.[i]?.result as `0x${string}` | undefined
    const hasWrapper = !!wAddr && wAddr !== zeroAddress
    const wrapped = hasWrapper ? (wrappedBalances?.[i]?.result ?? 0n) as bigint : 0n
    return {
      marketId: slot.market.marketId,
      market: slot.market,
      marketTitle: slot.market.title,
      conditionId: slot.market.conditionId,
      outcomeLabel: slot.label,
      indexSet: slot.indexSet,
      positionId: slot.positionId,
      balance: raw,
      wrapperAddress: hasWrapper ? wAddr! : null,
      wrappedBalance: wrapped,
    }
  }).filter(p => p.balance > 0n || p.wrappedBalance > 0n)

  return { positions, isLoading: rawLoading || wrappersLoading || wrappedLoading }
}