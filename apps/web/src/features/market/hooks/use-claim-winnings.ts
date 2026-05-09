import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  CONDITIONAL_TOKENS_ADDRESS,
  CONDITIONAL_TOKENS_ABI,
  POSITION_WRAPPER_ABI,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"

const TOAST_ID = "claim-winnings"

export interface ClaimablePosition {
  indexSet: bigint
  wrapperAddress: `0x${string}` | null
  wrappedBalance: bigint
}

export function useClaimWinnings() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  async function claimWinnings(market: Market, positions: ClaimablePosition[]) {
    if (!address || !publicClient || positions.length === 0) return
    setIsPending(true)
    try {
      // Step 1: Unwrap any ERC-20 wrapped positions → get ERC-1155 back
      const toUnwrap = positions.filter(p => p.wrapperAddress && p.wrappedBalance > 0n)
      for (const p of toUnwrap) {
        toast.loading("Unwrapping position tokens…", { id: TOAST_ID })
        const hash = await writeContractAsync({
          address: p.wrapperAddress!,
          abi: POSITION_WRAPPER_ABI,
          functionName: "unwrap",
          args: [p.wrappedBalance],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      }

      // Step 2: Ensure CT is approved to pull ERC-1155 from user
      const approved = await publicClient.readContract({
        address: CONDITIONAL_TOKENS_ADDRESS,
        abi: CONDITIONAL_TOKENS_ABI,
        functionName: "isApprovedForAll",
        args: [address, PREDICTION_MARKET_ADDRESS],
      })
      if (!approved) {
        toast.loading("Approving positions transfer…", { id: TOAST_ID })
        const approvalHash = await writeContractAsync({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "setApprovalForAll",
          args: [PREDICTION_MARKET_ADDRESS, true],
        })
        await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      }

      // Step 3: Redeem winning positions → TAB back
      toast.loading("Claiming winnings…", { id: TOAST_ID })
      const txHash = await writeContractAsync({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: "claimWinnings",
        args: [BigInt(market.marketId), positions.map(p => p.indexSet)],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })

      queryClient.invalidateQueries()
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