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

export const IntelligenceRequestSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  price_usd: z.number().nonnegative(),
  endpoint: z.string().regex(/^\/v1\//, "must be a /v1/* path"),
})

export const ChatResponseSchema = z.object({
  text: z.string(),
  tx_cards: z.array(TxCardSchema).default([]),
  intelligence_request: IntelligenceRequestSchema.nullish(),
})

export type TxStep = z.infer<typeof TxStepSchema>
export type TxCard = z.infer<typeof TxCardSchema>
export type IntelligenceRequest = z.infer<typeof IntelligenceRequestSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>

export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Cards attached to an assistant message. */
  txCards?: TxCard[]
  /** Paid intelligence request the user must fulfill via x402 to continue.
   *  Cleared once the user pays + the tool_result is sent back. */
  intelligenceRequest?: IntelligenceRequest
  /** Auto-play TTS once on mount. Set on assistant replies whose preceding
   *  user message came from voice input. Not persisted to sessionStorage. */
  autoSpeak?: boolean
}