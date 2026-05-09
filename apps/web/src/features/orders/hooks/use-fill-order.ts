import { useState } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { maxUint256 } from "viem"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  TABCOIN_ADDRESS,
  TABCLOB_ADDRESS,
  PREDICTION_MARKET_ADDRESS,
  ERC20_ABI,
  TABCLOB_ABI,
  PREDICTION_MARKET_ABI,
  POSITION_WRAPPER_ABI,
} from "@/lib/contracts"
import { deleteOrder } from "@/features/orders/api/orders"
import type { Order } from "@/features/orders/types"

const TAB = TABCOIN_ADDRESS.toLowerCase()
const TOAST_ID = "fill-order"

export function useFillOrder() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  // partialMakerAmount: how much of the maker's token to consume (omit = full fill)
  async function fillOrder(order: Order, partialMakerAmount?: bigint) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (!order.marketId) throw new Error("Order has no marketId")

    setIsPending(true)
    try {
      const isBuy = order.makerToken.toLowerCase() === TAB
      const fillMaker = partialMakerAmount ?? BigInt(order.makerAmount)
      // Proportional taker amount (bigint truncation is acceptable for CLOB fills)
      const fillTaker = partialMakerAmount
        ? (BigInt(order.takerAmount) * fillMaker / BigInt(order.makerAmount))
        : BigInt(order.takerAmount)

      if (isBuy) {
        // Filling a BUY order: taker must deliver takerToken (outcome wrapper ERC-20)
        // Check existing balance — skip split+wrap if already sufficient
        const erc20Bal = await publicClient.readContract({
          address: order.takerToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        })

        if (erc20Bal < fillTaker) {
          const deficit = fillTaker - erc20Bal
          const indexSet = await publicClient.readContract({
            address: order.takerToken as `0x${string}`,
            abi: POSITION_WRAPPER_ABI,
            functionName: "indexSet",
          })

          const tabAllowancePM = await publicClient.readContract({
            address: TABCOIN_ADDRESS, abi: ERC20_ABI,
            functionName: "allowance", args: [address, PREDICTION_MARKET_ADDRESS],
          })
          if (tabAllowancePM < deficit) {
            toast.loading("Approving TAB for split…", { id: TOAST_ID })
            const tx = await writeContractAsync({
              address: TABCOIN_ADDRESS, abi: ERC20_ABI,
              functionName: "approve", args: [PREDICTION_MARKET_ADDRESS, maxUint256],
              gas: 100_000n,
            })
            await publicClient.waitForTransactionReceipt({ hash: tx })
          }

          toast.loading("Splitting position…", { id: TOAST_ID })
          const splitTx = await writeContractAsync({
            address: PREDICTION_MARKET_ADDRESS, abi: PREDICTION_MARKET_ABI,
            functionName: "splitAndWrap",
            args: [BigInt(order.marketId), deficit, [indexSet]],
            gas: 500_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: splitTx })
        }

        // Approve outcome wrapper for CLOB
        const wrapperAllowance = await publicClient.readContract({
          address: order.takerToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (wrapperAllowance < fillTaker) {
          toast.loading("Approving outcome tokens…", { id: TOAST_ID })
          const tx = await writeContractAsync({
            address: order.takerToken as `0x${string}`, abi: ERC20_ABI,
            functionName: "approve", args: [TABCLOB_ADDRESS, maxUint256],
            gas: 100_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: tx })
        }
      } else {
        // Filling a SELL order: taker provides TABcoin
        const tabAllowanceCLOB = await publicClient.readContract({
          address: TABCOIN_ADDRESS, abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (tabAllowanceCLOB < fillTaker) {
          toast.loading("Approving TAB…", { id: TOAST_ID })
          const tx = await writeContractAsync({
            address: TABCOIN_ADDRESS, abi: ERC20_ABI,
            functionName: "approve", args: [TABCLOB_ADDRESS, maxUint256],
            gas: 100_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: tx })
        }
      }

      toast.loading("Filling order…", { id: TOAST_ID })
      const fillTx = await writeContractAsync({
        address: TABCLOB_ADDRESS,
        abi: TABCLOB_ABI,
        functionName: "fill",
        args: [
          {
            maker:       order.maker      as `0x${string}`,
            taker:       order.taker      as `0x${string}`,
            makerToken:  order.makerToken as `0x${string}`,
            takerToken:  order.takerToken as `0x${string}`,
            makerAmount: BigInt(order.makerAmount),
            takerAmount: BigInt(order.takerAmount),
            expiry:      BigInt(order.expiry),
            salt:        BigInt(order.salt),
            marketId:    BigInt(order.marketId),
          },
          fillMaker,
          order.signature as `0x${string}`,
        ],
        gas: 500_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: fillTx })

      // Only remove from BE mempool on full fill
      const isFullFill = !partialMakerAmount || partialMakerAmount >= BigInt(order.makerAmount)
      if (isFullFill) await deleteOrder(order.id)

      queryClient.invalidateQueries({ queryKey: ["orders"],    exact: false })
      queryClient.invalidateQueries({ queryKey: ["positions"], exact: false })

      toast.success("Order filled! Check your positions.", { id: TOAST_ID })
    } catch (err: unknown) {
      const rejected =
        err instanceof Error &&
        (err.message.toLowerCase().includes("rejected") ||
          err.message.toLowerCase().includes("denied"))
      if (rejected) toast.dismiss(TOAST_ID)
      else toast.error("Failed to fill order", { id: TOAST_ID })
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { fillOrder, isPending }
}