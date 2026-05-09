import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { PREDICTION_MARKET_ABI, PREDICTION_MARKET_ADDRESS } from "@/lib/contracts"
import type { Market } from "@/features/market/types"

const TOAST_ID = "claim-winnings"

export function useClaimWinnings() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  async function claimWinnings(market: Market, winningIndexSets: bigint[]) {
    if (!address || !publicClient) throw new Error("Not connected")
    setIsPending(true)
    try {
      toast.loading("Claiming winnings…", { id: TOAST_ID })
      const txHash = await writeContractAsync({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: "claimWinnings",
        args: [BigInt(market.marketId), winningIndexSets],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      queryClient.invalidateQueries({ queryKey: ["positions"], exact: false })
      toast.success("Winnings claimed!", { id: TOAST_ID })
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"))
      if (rejected) toast.dismiss(TOAST_ID)
      else toast.error("Failed to claim winnings", { id: TOAST_ID })
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { claimWinnings, isPending }
}