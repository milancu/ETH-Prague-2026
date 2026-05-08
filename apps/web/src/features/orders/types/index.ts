// Mirrors BE OrderRead (camelCase)
export interface Order {
  id: string
  createdAt: string           // ISO 8601 UTC
  marketId: number | null     // on-chain market_id; null for orders posted without market context
  maker: string               // 0x address
  taker: string               // 0x address (zero = open order)
  makerToken: string          // 0x address
  takerToken: string          // 0x address
  makerAmount: string         // decimal string (wei)
  takerAmount: string         // decimal string (wei)
  expiry: number              // unix timestamp (0 = no expiry)
  salt: string                // decimal string
  chainId: number
  verifyingContract: string   // 0x address — EIP-712 domain
  signature: string           // 0x hex, 65 bytes
  note: string | null
}

// Mirrors BE OrderCreate
export type CreateOrderPayload = Omit<Order, "id" | "createdAt">

// Server-side filters — passed as query params to GET /orders
export interface OrderFilters {
  marketId?: number   // ?market_id=
  maker?: string      // ?maker=0x...
}