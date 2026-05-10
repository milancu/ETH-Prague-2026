import { decodeFunctionData, parseEventLogs } from "viem"
import type { Hex, TransactionReceipt } from "viem"
import {
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
} from "@/lib/contracts"
import { postMarket } from "@/features/market/api/markets"
import type { OutcomeType } from "@/features/market/types"
import type { TxCard } from "./schema"

const CREATE_MARKET_SELECTOR = "0x6cd16f29"

const OUTCOME_TYPE_BY_INDEX: Record<number, OutcomeType> = {
  0: "binary",
  1: "multi",
  2: "scalar",
}

interface RunArgs {
  card: TxCard
  receipt: TransactionReceipt
  txHash: Hex
  creator: `0x${string}`
}

/**
 * Sync off-chain metadata to the BE for any tx-card that maps to a known
 * action. The chat path encodes calldata server-side and never relays the
 * structured payload to the FE, so we recover it from the calldata + receipt
 * logs after the tx confirms. Failures here are best-effort: the on-chain
 * state is already authoritative.
 */
export async function runPostActions(args: RunArgs): Promise<void> {
  const isPMv2 = args.card.to.toLowerCase() === PREDICTION_MARKET_ADDRESS.toLowerCase()
  const selector = args.card.data.slice(0, 10).toLowerCase()
  if (isPMv2 && selector === CREATE_MARKET_SELECTOR) {
    await registerCreatedMarket(args)
  }
}

async function registerCreatedMarket({ card, receipt, txHash, creator }: RunArgs): Promise<void> {
  const decoded = decodeFunctionData({
    abi: PREDICTION_MARKET_ABI,
    data: card.data as Hex,
  })
  if (decoded.functionName !== "createMarket") return
  const [params] = decoded.args as [
    {
      name: string
      description: string
      category: string
      outcomeType: number
      outcomeSlotCount: bigint
      outcomeLabels: readonly string[]
      oracle: `0x${string}`
      expiresAt: bigint
      resolutionTime: bigint
    },
  ]

  const events = parseEventLogs({
    abi: PREDICTION_MARKET_ABI,
    logs: receipt.logs,
    eventName: "MarketCreated",
  })
  const event = events[0]
  if (!event) throw new Error("MarketCreated event not found in receipt")

  const outcomeType = OUTCOME_TYPE_BY_INDEX[params.outcomeType] ?? "binary"

  await postMarket({
    market_id: Number(event.args.marketId),
    condition_id: event.args.conditionId,
    tx_hash: txHash,
    chain_id: card.chain_id,
    creator,
    title: params.name,
    description: params.description || null,
    category: params.category || "other",
    outcome_type: outcomeType,
    outcomes: params.outcomeLabels.map((label) => ({ label })),
    expires_at: new Date(Number(params.expiresAt) * 1000).toISOString(),
    resolution_time: new Date(Number(params.resolutionTime) * 1000).toISOString(),
  })
}