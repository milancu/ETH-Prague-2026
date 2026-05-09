import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { maxUint256 } from "viem"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  ERC20_ABI,
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import type { Market } from "@/features/market/types"

const TOAST_ID = "split-mint"

export function useSplit() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  async function split({ market, tabAmountWei }: { market: Market; tabAmountWei: bigint }) {
    if (!address || !publicClient) throw new Error("Not connected")
    setIsPending(true)
    try {
      const partition = getOutcomeSlots(market).map(s => s.indexSet)

      const allowance = await publicClient.readContract({
        address: TABCOIN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, PREDICTION_MARKET_ADDRESS],
      })
      if (allowance < tabAmountWei) {
        toast.loading("Approving TAB…", { id: TOAST_ID })
        const tx = await writeContractAsync({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [PREDICTION_MARKET_ADDRESS, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: tx })
      }

      toast.loading("Minting positions…", { id: TOAST_ID })
      const { request } = await publicClient.simulateContract({
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: "splitTo",
        args: [BigInt(market.marketId), partition, tabAmountWei],
        account: address,
      })
      const tx = await writeContractAsync(request)
      await publicClient.waitForTransactionReceipt({ hash: tx })

      queryClient.invalidateQueries()
      toast.success("Positions minted!", { id: TOAST_ID })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const rejected = msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied")
      if (rejected) toast.dismiss(TOAST_ID)
      else {
        const short = msg.split("\n")[0].slice(0, 120)
        toast.error(`Mint failed: ${short}`, { id: TOAST_ID })
      }
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { split, isPending }
}