import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  CONDITIONAL_TOKENS_ABI,
  CONDITIONAL_TOKENS_ADDRESS,
  FACTORY_ABI,
  POSITION_WRAPPER_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import type { Market } from "@/features/market/types"

export function useWrap() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  // tracks which indexSet is currently being wrapped (null = idle)
  const [wrapping, setWrapping] = useState<bigint | null>(null)

  async function wrap({
    market,
    indexSet,
    amount,
  }: {
    market: Market
    indexSet: bigint
    amount: bigint
  }) {
    if (!address || !publicClient) throw new Error("Not connected")
    const TOAST_ID = `wrap-${indexSet}`
    setWrapping(indexSet)
    try {
      const conditionId = market.conditionId as `0x${string}`

      // 1. Get or create the ERC-20 wrapper for this outcome
      let wrapperAddress = await publicClient.readContract({
        address: POSITION_WRAPPER_FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "getWrapper",
        args: [TABCOIN_ADDRESS, conditionId, indexSet],
      })
      const needsWrapper = BigInt(wrapperAddress) === 0n
      if (needsWrapper) {
        toast.loading("1/3 · Creating ERC-20 wrapper…", { id: TOAST_ID })
        const tx = await writeContractAsync({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getOrCreateWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        })
        await publicClient.waitForTransactionReceipt({ hash: tx })
        wrapperAddress = await publicClient.readContract({
          address: POSITION_WRAPPER_FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "getWrapper",
          args: [TABCOIN_ADDRESS, conditionId, indexSet],
        })
      }

      const wrapper = wrapperAddress as `0x${string}`

      // 2. Approve ConditionalTokens operator (ERC-1155 setApprovalForAll)
      const isApproved = await publicClient.readContract({
        address: CONDITIONAL_TOKENS_ADDRESS,
        abi: CONDITIONAL_TOKENS_ABI,
        functionName: "isApprovedForAll",
        args: [address, wrapper],
      })
      if (!isApproved) {
        const step = needsWrapper ? "2/3" : "1/2"
        toast.loading(`${step} · Approve ERC-1155 for wrapper (one-time)…`, { id: TOAST_ID })
        const tx = await writeContractAsync({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "setApprovalForAll",
          args: [wrapper, true],
        })
        await publicClient.waitForTransactionReceipt({ hash: tx })
      }

      // 3. Wrap ERC-1155 → ERC-20
      const wrapStep = needsWrapper ? "3/3" : !isApproved ? "2/2" : ""
      toast.loading(`${wrapStep ? `${wrapStep} · ` : ""}Wrapping to ERC-20…`, { id: TOAST_ID })
      const tx = await writeContractAsync({
        address: wrapper,
        abi: POSITION_WRAPPER_ABI,
        functionName: "wrap",
        args: [amount],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })

      queryClient.invalidateQueries()
      toast.success("Wrapped to ERC-20!", { id: TOAST_ID })
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"))
      if (!rejected) toast.error("Failed to wrap", { id: `wrap-${indexSet}` })
      throw err
    } finally {
      setWrapping(null)
    }
  }

  return { wrap, wrapping }
}