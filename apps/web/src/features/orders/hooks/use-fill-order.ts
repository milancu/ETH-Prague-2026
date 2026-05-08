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

  async function fillOrder(order: Order) {
    if (!address || !publicClient) throw new Error("Not connected")
    if (!order.marketId) throw new Error("Order has no marketId")

    setIsPending(true)
    try {
      const isBuy = order.makerToken.toLowerCase() === TAB
      const fillMakerAmount = BigInt(order.makerAmount)
      const fillTakerAmount = BigInt(order.takerAmount)

      if (isBuy) {
        // Taker is selling outcome tokens → needs to split TABcoin first.
        // Read the indexSet of the outcome wrapper (takerToken of the BUY order).
        const indexSet = await publicClient.readContract({
          address: order.takerToken as `0x${string}`,
          abi: POSITION_WRAPPER_ABI,
          functionName: "indexSet",
        })

        // Approve TABcoin → PredictionMarketV2 for the split
        const tabAllowancePM = await publicClient.readContract({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, PREDICTION_MARKET_ADDRESS],
        })
        if (tabAllowancePM < fillTakerAmount) {
          toast.loading("Approving TAB for split…", { id: TOAST_ID })
          const tx = await writeContractAsync({
            address: TABCOIN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [PREDICTION_MARKET_ADDRESS, maxUint256],
            gas: 100_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: tx })
        }

        // splitAndWrap: deposit fillTakerAmount TABcoin, receive outcome wrapper ERC-20
        toast.loading("Splitting position…", { id: TOAST_ID })
        const splitTx = await writeContractAsync({
          address: PREDICTION_MARKET_ADDRESS,
          abi: PREDICTION_MARKET_ABI,
          functionName: "splitAndWrap",
          args: [BigInt(order.marketId), fillTakerAmount, [indexSet]],
          gas: 500_000n,
        })
        await publicClient.waitForTransactionReceipt({ hash: splitTx })

        // Approve outcome wrapper → TabClob
        const wrapperAllowance = await publicClient.readContract({
          address: order.takerToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (wrapperAllowance < fillTakerAmount) {
          toast.loading("Approving outcome tokens…", { id: TOAST_ID })
          const tx = await writeContractAsync({
            address: order.takerToken as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [TABCLOB_ADDRESS, maxUint256],
            gas: 100_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: tx })
        }
      } else {
        // Taker is buying outcome tokens with TABcoin — just approve TABcoin
        const tabAllowanceCLOB = await publicClient.readContract({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, TABCLOB_ADDRESS],
        })
        if (tabAllowanceCLOB < fillTakerAmount) {
          toast.loading("Approving TAB…", { id: TOAST_ID })
          const tx = await writeContractAsync({
            address: TABCOIN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [TABCLOB_ADDRESS, maxUint256],
            gas: 100_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash: tx })
        }
      }

      // Fill on-chain
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
            makerAmount: fillMakerAmount,
            takerAmount: fillTakerAmount,
            expiry:      BigInt(order.expiry),
            salt:        BigInt(order.salt),
            marketId:    BigInt(order.marketId),
          },
          fillMakerAmount,
          order.signature as `0x${string}`,
        ],
        gas: 500_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: fillTx })

      // Remove from BE mempool
      await deleteOrder(order.id)
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