import { useState } from "react"
import { usePublicClient, useSimulateContract, useWriteContract } from "wagmi"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { PREDICTION_MARKET_ABI, PREDICTION_MARKET_ADDRESS } from "@/lib/contracts"
import { patchMarketStatus } from "@/features/market/api/markets"
import type { Market } from "@/features/market/types"

const TOAST_ID = "resolve-market"

export function useResolveMarket(market: Market, payouts: bigint[]) {
  const publicClient = usePublicClient()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  const { data: simulation } = useSimulateContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: "resolveMarket",
    args: [BigInt(market.marketId), payouts],
    query: { enabled: payouts.length > 0, retry: false },
  })

  const { writeContractAsync } = useWriteContract()

  async function resolveMarket() {
    if (!publicClient || !simulation) throw new Error("Cannot resolve")
    setIsPending(true)
    try {
      toast.loading("Resolving market on-chain…", { id: TOAST_ID })
      const txHash = await writeContractAsync(simulation.request)
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      toast.loading("Syncing status…", { id: TOAST_ID })
      await patchMarketStatus(market.marketId, "resolved")

      await queryClient.invalidateQueries({ queryKey: ["markets"], exact: false })
      toast.success("Market resolved!", { id: TOAST_ID })
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"))
      if (rejected) toast.dismiss(TOAST_ID)
      else toast.error("Failed to resolve market", { id: TOAST_ID })
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { resolveMarket, isPending, canResolve: !!simulation }
}