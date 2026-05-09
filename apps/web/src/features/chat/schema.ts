import { z } from "zod"

const HexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-hex-char address")

const HexData = z.string().regex(/^0x[a-fA-F0-9]*$/, "must be hex calldata")

const NumericString = z
  .string()
  .regex(/^\d+$/, "must be a non-negative integer string (wei)")

const TxStepSchema = z.object({
  to: HexAddress,
  data: HexData,
  value: NumericString.default("0"),
  summary: z.string(),
})

export const TxCardSchema = TxStepSchema.extend({
  chain_id: z.number().int().positive(),
  requires: z.array(TxStepSchema).default([]),
  notice: z.string().nullish(),
})

export const ChatResponseSchema = z.object({
  text: z.string(),
  tx_cards: z.array(TxCardSchema).default([]),
})

export type TxStep = z.infer<typeof TxStepSchema>
export type TxCard = z.infer<typeof TxCardSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>

export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Cards attached to an assistant message. */
  txCards?: TxCard[]
  /** Auto-play TTS once on mount. Set on assistant replies whose preceding
   *  user message came from voice input. Not persisted to sessionStorage. */
  autoSpeak?: boolean
}