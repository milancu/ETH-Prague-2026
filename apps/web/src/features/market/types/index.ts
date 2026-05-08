export type MarketCategory = "Politics" | "Sport" | "Czech" | "Finance" | "Weather"
export type MarketStatus = "pending" | "open" | "resolved" | "cancelled"
export type OutcomeType = "binary" | "multi" | "scalar"

export interface MultiOutcome {
  id: string
  label: string
  price: number
}

interface MarketBase {
  id: string              // stringified BE integer id
  marketId: number        // on-chain market_id
  conditionId: string
  txHash: string
  chainId: number
  creator: string
  title: string
  description: string | null
  rules: string | null
  category: MarketCategory
  closingDate: Date       // maps from BE expires_at
  status: MarketStatus
  createdAt: Date
}

export interface BinaryMarket extends MarketBase {
  outcomeType: "binary"
  yesPrice: number        // 0–100; from order book (defaults to 50)
  noPrice: number
}

export interface MultiMarket extends MarketBase {
  outcomeType: "multi"
  outcomes: MultiOutcome[]
}

export interface ScalarMarket extends MarketBase {
  outcomeType: "scalar"
  scalarMin: number
  scalarMax: number
  scalarUnit: string
  currentValue: number
}

export type Market = BinaryMarket | MultiMarket | ScalarMarket

// ── Filters (server-side — passed as query params) ────────────────────────────

export interface MarketFilters {
  category?: MarketCategory
  status?: MarketStatus
  outcomeType?: OutcomeType
  chainId?: number
  page?: number
  limit?: number
}

// ── Paginated list response ───────────────────────────────────────────────────

export interface MarketPage {
  markets: Market[]
  total: number
  page: number
  limit: number
}