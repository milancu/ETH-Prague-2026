import { keccak256, encodePacked } from "viem"
import { TABCOIN_ADDRESS } from "@/lib/contracts"
import type { Market } from "@/features/market/types"

export interface OutcomeSlot {
  label: string
  indexSet: bigint
}

export function getOutcomeSlots(market: Market): OutcomeSlot[] {
  if (market.outcomeType === "binary") {
    return [
      { label: "YES", indexSet: 1n },
      { label: "NO",  indexSet: 2n },
    ]
  }
  if (market.outcomeType === "multi") {
    return market.outcomes.map((o, i) => ({ label: o.label, indexSet: 1n << BigInt(i) }))
  }
  return [
    { label: "Higher", indexSet: 1n },
    { label: "Lower",  indexSet: 2n },
  ]
}

export function getPositionId(conditionId: `0x${string}`, indexSet: bigint): bigint {
  const collectionId = keccak256(
    encodePacked(["bytes32", "uint256"], [conditionId, indexSet]),
  )
  return BigInt(
    keccak256(encodePacked(["address", "bytes32"], [TABCOIN_ADDRESS, collectionId])),
  )
}

export function formatBalance(wei: bigint, decimals = 4): string {
  const whole = wei / 10n ** 18n
  const frac = wei % 10n ** 18n
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "")
  return fracStr.length > 0 ? `${whole}.${fracStr}` : String(whole)
}