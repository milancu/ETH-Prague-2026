import { apiClient } from "@/utils/api-client"
import {
  DiceCommitResponseSchema,
  DiceLinkResponseSchema,
  DiceRevealResponseSchema,
  type DiceCommitResponse,
  type DiceRevealResponse,
} from "@/features/dice/lib/schema"

export interface DiceCommitPayload {
  name: string
  description: string
  delay_minutes: number
  user_address: `0x${string}`
  chain_id: number
}

export async function postDiceCommit(
  payload: DiceCommitPayload,
): Promise<DiceCommitResponse> {
  const { data } = await apiClient.post("/dice/commit", payload)
  return DiceCommitResponseSchema.parse(data)
}

export async function postDiceLink(
  commitmentId: number,
  marketId: number,
): Promise<void> {
  const { data } = await apiClient.post(`/dice/${commitmentId}/link`, {
    market_id: marketId,
  })
  DiceLinkResponseSchema.parse(data)
}

export async function postDiceReveal(
  commitmentId: number,
  chainId: number,
): Promise<DiceRevealResponse> {
  const { data } = await apiClient.post(
    `/dice/${commitmentId}/reveal`,
    null,
    { params: { chain_id: chainId } },
  )
  return DiceRevealResponseSchema.parse(data)
}
