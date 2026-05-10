import { useQuery } from "@tanstack/react-query"
import { fetchOrder } from "@/features/orders/api/orders"

export function useOrder(id: string) {
  return useQuery({
    queryKey: ["orders", id],
    queryFn: () => fetchOrder(id),
    enabled: !!id,
  })
}