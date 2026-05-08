import { useQuery } from "@tanstack/react-query"
import { fetchMarkets } from "@/features/market/api/markets"
import type { MarketFilters } from "@/features/market/types"

export function useMarkets(filters?: MarketFilters) {
  return useQuery({
    queryKey: ["markets", filters ?? null],
    queryFn: () => fetchMarkets(filters),
    staleTime: 15_000,
  })
}