import { z } from "zod"
import { TxCardSchema } from "@/features/chat/schema"

export const diceCreateFormSchema = z.object({
  title: z.string().min(3, "At least 3 characters"),
  description: z.string().optional(),
  delayMinutes: z.coerce
    .number({ invalid_type_error: "Required" })
    .min(1, "At least 1 minute")
    .max(120, "At most 120 minutes"),
})

export type DiceCreateFormInput = z.infer<typeof diceCreateFormSchema>

const DiceCommitmentSchema = z.object({
  id: z.number().int().nonnegative(),
  commitment_hash: z.string(),
  target_sequence: z.number().int().nonnegative(),
  estimated_reveal_unix: z.number().int().nonnegative(),
  delay_minutes: z.number(),
})

export const DiceCommitResponseSchema = z.object({
  status: z.literal("tx_card_created"),
  summary: z.string().optional().default(""),
  tx_card: TxCardSchema,
  commitment: DiceCommitmentSchema,
})

export const DiceLinkResponseSchema = z.object({
  status: z.literal("linked"),
  market_id: z.string(),
})

const DiceRevealReadySchema = z.object({
  status: z.literal("tx_card_created"),
  summary: z.string().optional().default(""),
  tx_card: TxCardSchema,
  die: z.number().int().min(1).max(6),
  seed_hex: z.string(),
  ctrng: z.string(),
  beacon_sequence: z.number().int().nonnegative(),
  payouts: z.array(z.number().int().min(0)),
})

const DiceRevealNotReadySchema = z.object({
  status: z.literal("not_ready"),
  eta_seconds: z.number().int().nonnegative(),
  target_sequence: z.number().int().nonnegative(),
})

const DiceRevealAlreadyResolvedSchema = z.object({
  status: z.literal("already_revealed"),
  die: z.number().int().min(1).max(6),
  seed_hex: z.string(),
})

export const DiceRevealResponseSchema = z.discriminatedUnion("status", [
  DiceRevealReadySchema,
  DiceRevealNotReadySchema,
  DiceRevealAlreadyResolvedSchema,
])

export type DiceCommitResponse = z.infer<typeof DiceCommitResponseSchema>
export type DiceCommitment = z.infer<typeof DiceCommitmentSchema>
export type DiceRevealResponse = z.infer<typeof DiceRevealResponseSchema>
export type DiceRevealReady = z.infer<typeof DiceRevealReadySchema>
