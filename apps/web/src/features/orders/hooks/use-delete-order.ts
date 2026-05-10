import { useMutation, useQueryClient } from "@tanstack/react-query"
import { usePublicClient, useWriteContract } from "wagmi"
import { deleteOrder } from "@/features/orders/api/orders"
import { TABCLOB_ADDRESS, TABCLOB_ABI } from "@/lib/contracts"
import type { Order } from "@/features/orders/types"

export function useDeleteOrder() {
  const queryClient = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  return useMutation({
    mutationFn: async (order: Order) => {
      // Cancel on-chain first so the order can't be filled after removal from BE.
      // Swallow errors — if already filled/cancelled the BE delete still proceeds.
      try {
        const txHash = await writeContractAsync({
          address: TABCLOB_ADDRESS,
          abi: TABCLOB_ABI,
          functionName: "cancel",
          args: [{
            maker:       order.maker      as `0x${string}`,
            taker:       order.taker      as `0x${string}`,
            makerToken:  order.makerToken as `0x${string}`,
            takerToken:  order.takerToken as `0x${string}`,
            makerAmount: BigInt(order.makerAmount),
            takerAmount: BigInt(order.takerAmount),
            expiry:      BigInt(order.expiry),
            salt:        BigInt(order.salt),
            marketId:    BigInt(order.marketId ?? 0),
          }],
        })
        await publicClient!.waitForTransactionReceipt({ hash: txHash })
      } catch {
        // already cancelled / filled on-chain — continue to BE delete
      }
      await deleteOrder(order.id)
    },
    onMutate: async (order) => {
      await queryClient.cancelQueries({ queryKey: ["orders"], exact: false })
      const entries = queryClient.getQueriesData<Order[]>({ queryKey: ["orders"] })
      entries.forEach(([key]) => {
        queryClient.setQueryData<Order[]>(key, (old) => old?.filter(o => o.id !== order.id) ?? [])
      })
      return { entries }
    },
    onError: (_err, _order, context) => {
      context?.entries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"], exact: false })
    },
  })
}