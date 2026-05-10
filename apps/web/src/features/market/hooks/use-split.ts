import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { BaseError, ContractFunctionRevertedError, maxUint256 } from "viem"
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
        toast.error(`Mint failed: ${formatRevert(err)}`, { id: TOAST_ID })
      }
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { split, isPending }
}

/**
 * Pulls the actual revert reason out of a viem error.
 * Prefers the decoded custom-error name + args (when ABI carries the error),
 * falls back to `shortMessage`, then to the first line of the message.
 */
function formatRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const errName = reverted.data?.errorName
      if (errName) {
        const args = reverted.data?.args
        const argStr = Array.isArray(args) && args.length > 0 ? `(${args.map(String).join(", ")})` : ""
        return `${errName}${argStr}`
      }
      if (reverted.reason) return reverted.reason
    }
    return err.shortMessage
  }
  if (err instanceof Error) return err.message.split("\n")[0].slice(0, 160)
  return String(err)
}