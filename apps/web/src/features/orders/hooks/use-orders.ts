import { useQuery } from "@tanstack/react-query"
import { fetchOrders } from "@/features/orders/api/orders"
import type { OrderFilters } from "@/features/orders/types"

export function useOrders(filters?: OrderFilters) {
  return useQuery({
    queryKey: ["orders", filters ?? null],
    queryFn: () => fetchOrders(filters),
    staleTime: 10_000,
  })
}