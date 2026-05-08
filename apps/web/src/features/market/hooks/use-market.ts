import { useQuery } from "@tanstack/react-query"
import { fetchMarket } from "@/features/market/api/markets"

export function useMarket(id: string) {
  return useQuery({
    queryKey: ["markets", id],
    queryFn: () => fetchMarket(id),
    enabled: !!id,
    staleTime: 15_000,
  })
}