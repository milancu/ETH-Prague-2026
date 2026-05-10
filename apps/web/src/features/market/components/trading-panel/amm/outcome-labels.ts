import type { Market } from "@/features/market/types"

/**
 * Build a fixed list of display labels per outcome slot index, matching the
 * order PredictionAMM uses internally (indexSet = 1 << i).
 *
 * Length is always >= 2; for binary/scalar it's exactly 2.
 */
export function outcomeLabels(market: Market): string[] {
  if (market.outcomeType === "binary") return ["YES", "NO"]
  if (market.outcomeType === "scalar") return ["HIGHER", "LOWER"]
  return market.outcomes.map((o) => o.label)
}
