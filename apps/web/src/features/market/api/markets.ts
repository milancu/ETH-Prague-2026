import { apiClient } from "@/utils/api-client"
import type {
  Market,
  MarketCategory,
  MarketFilters,
  MarketPage,
  MarketStatus,
  OutcomeType,
} from "@/features/market/types"

// ── BE response shape (snake_case) ────────────────────────────────────────────

interface MarketDTO {
  id: number
  market_id: number
  condition_id: string
  tx_hash: string
  chain_id: number
  creator: string
  title: string
  description: string | null
  rules: string | null
  category: MarketCategory
  outcome_type: OutcomeType
  outcomes: Array<{ label: string; [key: string]: unknown }>
  scalar_min: number | null
  scalar_max: number | null
  scalar_unit: string | null
  current_value: number | null
  expires_at: string      // ISO 8601 UTC
  resolution_time: string
  status: MarketStatus
  created_at: string
}

interface MarketsPageDTO {
  markets: MarketDTO[]
  total: number
  page: number
  limit: number
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function dtoToMarket(dto: MarketDTO): Market {
  const base = {
    id: String(dto.market_id),
    marketId: dto.market_id,
    conditionId: dto.condition_id,
    txHash: dto.tx_hash,
    chainId: dto.chain_id,
    creator: dto.creator,
    title: dto.title,
    description: dto.description,
    rules: dto.rules,
    category: dto.category,
    closingDate: new Date(dto.expires_at),
    status: dto.status,
    createdAt: new Date(dto.created_at),
  }

  if (dto.outcome_type === "binary") {
    return { ...base, outcomeType: "binary", yesPrice: 50, noPrice: 50 }
  }
  if (dto.outcome_type === "multi") {
    const equalPrice = Math.round(100 / dto.outcomes.length)
    return {
      ...base,
      outcomeType: "multi",
      outcomes: dto.outcomes.map((o, i) => ({ id: String(i), label: o.label, price: equalPrice })),
    }
  }
  return {
    ...base,
    outcomeType: "scalar",
    scalarMin: dto.scalar_min ?? 0,
    scalarMax: dto.scalar_max ?? 100,
    scalarUnit: dto.scalar_unit ?? "",
    currentValue: dto.current_value ?? 0,
  }
}

// ── Query params builder ──────────────────────────────────────────────────────

function toParams(filters?: MarketFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (filters?.category)    p.set("category", filters.category)
  if (filters?.status)      p.set("status", filters.status)
  if (filters?.outcomeType) p.set("outcome_type", filters.outcomeType)
  if (filters?.chainId)     p.set("chain_id", String(filters.chainId))
  if (filters?.page)        p.set("page", String(filters.page))
  if (filters?.limit)       p.set("limit", String(filters.limit))
  return p
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function fetchMarkets(filters?: MarketFilters): Promise<MarketPage> {
  const { data } = await apiClient.get<MarketsPageDTO>("/markets", {
    params: toParams(filters),
  })
  return {
    markets: data.markets.map(dtoToMarket),
    total: data.total,
    page: data.page,
    limit: data.limit,
  }
}

export async function fetchMarket(id: string): Promise<Market> {
  const { data } = await apiClient.get<MarketDTO>(`/markets/${id}`)
  return dtoToMarket(data)
}

// ── POST payload (sent after on-chain createMarket) ───────────────────────────

export interface PostMarketPayload {
  market_id: number
  condition_id: string
  tx_hash: string
  chain_id: number
  creator: string
  title: string
  description?: string | null
  rules?: string | null
  category: string
  outcome_type: OutcomeType
  outcomes: Array<{ label: string }>
  scalar_min?: number | null
  scalar_max?: number | null
  scalar_unit?: string | null
  current_value?: number | null
  expires_at: string       // ISO 8601 UTC datetime
  resolution_time: string
}

export async function postMarket(payload: PostMarketPayload): Promise<{ id: number }> {
  const { data } = await apiClient.post<{ id: number }>("/markets", payload)
  return data
}