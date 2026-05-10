import { useMemo } from "react"
import { useAccount, useReadContracts, useWatchContractEvent } from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import {
  PREDICTION_AMM_ABI,
  PREDICTION_AMM_ADDRESS,
} from "@/lib/contracts"

export interface PoolData {
  exists: boolean
  outcomeSlotCount: number
  feeBps: number
  totalShares: bigint
  feeAccumulated: bigint
  reserves: readonly bigint[]
  wrappers: readonly `0x${string}`[]
}

export interface UserPoolData {
  shares: bigint
  totalShares: bigint
  pendingFees: bigint
}

export interface UseAmmPoolResult {
  pool: PoolData | null
  user: UserPoolData
  probabilities: number[]
  totalReserveTab: bigint
  isLoading: boolean
  refetch: () => void
}

const ZERO_USER: UserPoolData = { shares: 0n, totalShares: 0n, pendingFees: 0n }

/**
 * Reads AMM pool state for a given market and watches all 5 AMM events to
 * keep the data fresh in real time. A non-existent pool (`getPool` reverts
 * with `PoolMissing`) surfaces as `pool === null`.
 */
export function useAmmPool(marketId: number | null | undefined): UseAmmPoolResult {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const enabled = marketId != null

  const { data, isLoading, refetch, queryKey } = useReadContracts({
    allowFailure: true,
    contracts: enabled
      ? [
          {
            address: PREDICTION_AMM_ADDRESS,
            abi: PREDICTION_AMM_ABI,
            functionName: "getPool",
            args: [BigInt(marketId)],
          } as const,
          {
            address: PREDICTION_AMM_ADDRESS,
            abi: PREDICTION_AMM_ABI,
            functionName: "getShares",
            args: [BigInt(marketId), (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
          } as const,
          {
            address: PREDICTION_AMM_ADDRESS,
            abi: PREDICTION_AMM_ABI,
            functionName: "pendingFeesOf",
            args: [BigInt(marketId), (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
          } as const,
        ]
      : [],
    query: { enabled, staleTime: 5_000, refetchInterval: 15_000 },
  })

  const pool: PoolData | null = useMemo(() => {
    const r = data?.[0]
    if (!r || r.status !== "success" || !r.result) return null
    const p = r.result as {
      exists: boolean
      outcomeSlotCount: number
      feeBps: number
      conditionId: `0x${string}`
      totalShares: bigint
      feeAccumulated: bigint
      reserves: readonly bigint[]
      wrappers: readonly `0x${string}`[]
    }
    if (!p.exists) return null
    return {
      exists: p.exists,
      outcomeSlotCount: p.outcomeSlotCount,
      feeBps: p.feeBps,
      totalShares: p.totalShares,
      feeAccumulated: p.feeAccumulated,
      reserves: p.reserves,
      wrappers: p.wrappers,
    }
  }, [data])

  const user: UserPoolData = useMemo(() => {
    if (!address || !pool) return ZERO_USER
    const sharesEntry = data?.[1]
    const feesEntry = data?.[2]
    const sharesTuple =
      sharesEntry && sharesEntry.status === "success"
        ? (sharesEntry.result as readonly [bigint, bigint])
        : null
    const pendingFees =
      feesEntry && feesEntry.status === "success" ? (feesEntry.result as bigint) : 0n
    return {
      shares: sharesTuple?.[0] ?? 0n,
      totalShares: sharesTuple?.[1] ?? pool.totalShares,
      pendingFees,
    }
  }, [address, pool, data])

  const { probabilities, totalReserveTab } = useMemo(() => {
    if (!pool || pool.reserves.length === 0) {
      return { probabilities: [] as number[], totalReserveTab: 0n }
    }
    const sum = pool.reserves.reduce((s, r) => s + r, 0n)
    if (sum === 0n) {
      return {
        probabilities: pool.reserves.map(() => 1 / pool.reserves.length),
        totalReserveTab: 0n,
      }
    }
    // Implied probability for outcome i = (sum - r_i) / ((N-1) * sum)
    // For N=2 this collapses to r_other / sum, matching the spec.
    const N = pool.reserves.length
    const sumNum = Number(sum)
    const probs = pool.reserves.map((r) => {
      const numer = sumNum - Number(r)
      return numer / ((N - 1) * sumNum)
    })
    // Conservative pool TAB value: min reserve = redeemable TAB if everyone exits.
    const minR = pool.reserves.reduce((m, r) => (r < m ? r : m), pool.reserves[0])
    return { probabilities: probs, totalReserveTab: minR }
  }, [pool])

  function invalidate() {
    refetch()
    if (marketId != null) {
      queryClient.invalidateQueries({ queryKey: ["amm", marketId], exact: false })
    }
    queryClient.invalidateQueries({ queryKey, exact: false })
  }

  // Watch all 5 events so other users' actions also refresh our view.
  useWatchContractEvent({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    eventName: "PoolCreated",
    args: enabled ? { marketId: BigInt(marketId!) } : undefined,
    enabled,
    onLogs: () => invalidate(),
  })
  useWatchContractEvent({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    eventName: "FundingAdded",
    args: enabled ? { marketId: BigInt(marketId!) } : undefined,
    enabled,
    onLogs: () => invalidate(),
  })
  useWatchContractEvent({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    eventName: "FundingRemoved",
    args: enabled ? { marketId: BigInt(marketId!) } : undefined,
    enabled,
    onLogs: () => invalidate(),
  })
  useWatchContractEvent({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    eventName: "Bought",
    args: enabled ? { marketId: BigInt(marketId!) } : undefined,
    enabled,
    onLogs: () => invalidate(),
  })
  useWatchContractEvent({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    eventName: "Sold",
    args: enabled ? { marketId: BigInt(marketId!) } : undefined,
    enabled,
    onLogs: () => invalidate(),
  })

  return {
    pool,
    user,
    probabilities,
    totalReserveTab,
    isLoading,
    refetch: invalidate,
  }
}
