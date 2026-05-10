import { useMemo } from "react"
import { useReadContracts } from "wagmi"
import {
  getOutcomeSlots,
  getPositionId,
} from "@/features/positions/lib/utils"
import {
  CONDITIONAL_TOKENS_ABI,
  CONDITIONAL_TOKENS_ADDRESS,
  ERC20_ABI,
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"

export function usePositionData(address: `0x${string}` | undefined, market: Market) {
  const slots = useMemo(() => getOutcomeSlots(market), [market])
  const conditionId = market.conditionId as `0x${string}`

  const { data: rawData, refetch: refetchRaw } = useReadContracts({
    contracts: address
      ? slots.map(({ indexSet }) => ({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "balanceOf" as const,
          args: [address, getPositionId(conditionId, indexSet)] as const,
        }))
      : [],
    query: { enabled: !!address, staleTime: 10_000 },
  })

  const { data: wrapperData, refetch: refetchWrappers } = useReadContracts({
    contracts: slots.map(({ indexSet }) => ({
      address: POSITION_WRAPPER_FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getWrapper" as const,
      args: [TABCOIN_ADDRESS, conditionId, indexSet] as const,
    })),
    query: { staleTime: 20_000 },
  })

  const wrappers = slots.map((_, i) => {
    const w = wrapperData?.[i]?.result as `0x${string}` | undefined
    return w && BigInt(w) !== 0n ? w : null
  })

  const existingWrapperContracts = address
    ? wrappers.flatMap((w, i) =>
        w ? [{ slotIndex: i, contract: { address: w, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address] as const } }] : []
      )
    : []

  const { data: erc20Data, refetch: refetchErc20 } = useReadContracts({
    contracts: existingWrapperContracts.map(x => x.contract),
    query: { enabled: !!address && existingWrapperContracts.length > 0, staleTime: 10_000 },
  })

  const erc20Balances = slots.map((_, slotIdx) => {
    const idx = existingWrapperContracts.findIndex(x => x.slotIndex === slotIdx)
    if (idx < 0) return 0n
    return (erc20Data?.[idx]?.result ?? 0n) as bigint
  })

  function refetch() { refetchRaw(); refetchWrappers(); refetchErc20() }

  return {
    slots,
    rawBalances: slots.map((_, i) => (rawData?.[i]?.result ?? 0n) as bigint),
    erc20Balances,
    wrappers,
    refetch,
  }
}