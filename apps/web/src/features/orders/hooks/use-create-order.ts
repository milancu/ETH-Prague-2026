import { useMutation, useQueryClient } from "@tanstack/react-query"
import { postOrder } from "@/features/orders/api/orders"
import type { CreateOrderPayload } from "@/features/orders/types"

// Accepts a fully-built, EIP-712-signed payload.
// Signing is the caller's responsibility (useSignTypedData from wagmi).
export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateOrderPayload) => postOrder(payload),
    onSuccess: () => {
      // Invalidate all orders queries regardless of filters
      queryClient.invalidateQueries({ queryKey: ["orders"], exact: false })
    },
  })
}