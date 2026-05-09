import { apiClient } from "@/utils/api-client"

export interface CommentNode {
  id: number
  author: string
  content: string
  created_at: string
  replies: CommentNode[]
}

export async function fetchComments(marketId: string): Promise<CommentNode[]> {
  const { data } = await apiClient.get<CommentNode[]>(`/markets/${marketId}/comments`)
  return data
}

export async function postComment(
  marketId: string,
  payload: { author: string; content: string; parent_id?: number | null },
): Promise<CommentNode> {
  const { data } = await apiClient.post<CommentNode>(`/markets/${marketId}/comments`, payload)
  return data
}
