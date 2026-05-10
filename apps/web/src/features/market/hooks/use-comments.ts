import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchComments, postComment } from "@/features/market/api/comments"

export function useComments(marketId: string) {
  return useQuery({
    queryKey: ["comments", marketId],
    queryFn: () => fetchComments(marketId),
    enabled: !!marketId,
    staleTime: 30_000,
  })
}

export function usePostComment(marketId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { author: string; content: string; parent_id?: number | null }) =>
      postComment(marketId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", marketId] })
    },
  })
}
