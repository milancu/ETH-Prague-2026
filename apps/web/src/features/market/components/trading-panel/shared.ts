// Shared types, constants, and pure helpers – no JSX

import type { Market, MarketCategory } from "@/features/market/types"
import type { OutcomeSlot } from "@/features/positions/lib/utils"
import { TABCOIN_ADDRESS } from "@/lib/contracts"

// ── Palette ───────────────────────────────────────────────────────────────────

export type SlotPalette = {
  text: string
  bar: string
  activeBg: string
  ring: string
  dot: string
}

export const BINARY_PALETTE: SlotPalette[] = [
  { text: "text-emerald-400", bar: "bg-emerald-500", activeBg: "bg-emerald-500/10", ring: "ring-emerald-500/30", dot: "bg-emerald-400" },
  { text: "text-rose-400",    bar: "bg-rose-500",    activeBg: "bg-rose-500/10",    ring: "ring-rose-500/30",    dot: "bg-rose-400"    },
]

export const MULTI_PALETTE: SlotPalette[] = [
  { text: "text-blue-400",   bar: "bg-blue-500",   activeBg: "bg-blue-500/10",   ring: "ring-blue-500/30",   dot: "bg-blue-400"   },
  { text: "text-violet-400", bar: "bg-violet-500", activeBg: "bg-violet-500/10", ring: "ring-violet-500/30", dot: "bg-violet-400" },
  { text: "text-amber-400",  bar: "bg-amber-500",  activeBg: "bg-amber-500/10",  ring: "ring-amber-500/30",  dot: "bg-amber-400"  },
  { text: "text-cyan-400",   bar: "bg-cyan-500",   activeBg: "bg-cyan-500/10",   ring: "ring-cyan-500/30",   dot: "bg-cyan-400"   },
]

export function slotPalette(index: number, market: Market): SlotPalette {
  if (market.outcomeType === "binary" || market.outcomeType === "scalar")
    return BINARY_PALETTE[index % 2]
  return MULTI_PALETTE[index % MULTI_PALETTE.length]
}

export const CATEGORY_BAR: Record<MarketCategory, string> = {
  Finance: "bg-amber-500/60", Politics: "bg-blue-500/60",
  Sport:   "bg-emerald-500/60", Czech: "bg-purple-500/60",
  Weather: "bg-cyan-500/60",
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TAB_LC = TABCOIN_ADDRESS.toLowerCase()

// ── SlotContext ───────────────────────────────────────────────────────────────
// Derived state for the currently selected outcome slot.

export interface SlotContext {
  idx: number
  selectedId: string    // raw outcome ID (used by placeOrder / outcomeToIndexSet)
  label: string         // display label (YES, NO, HIGHER, LOWER, or multi label)
  wrapper: `0x${string}` | null
  palette: SlotPalette
  freeNum: number       // free ERC-20 (not locked in orders)
  rawNum: number        // ERC-1155 (raw, not wrapped)
  totalNum: number      // freeNum + rawNum (max sellable)
  erc20Total: bigint    // total ERC-20 (free + committed)
  committed: bigint     // locked in open sell orders
}

export const NULL_SLOT_CTX: SlotContext = {
  idx: -1, selectedId: "", label: "", wrapper: null, palette: BINARY_PALETTE[0],
  freeNum: 0, rawNum: 0, totalNum: 0, erc20Total: 0n, committed: 0n,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function outcomeToSlotIdx(
  outcomeId: string,
  slots: OutcomeSlot[],
  market: Market,
): number {
  return slots.findIndex(s => {
    if (market.outcomeType === "binary" || market.outcomeType === "scalar")
      return s.label.toLowerCase() === outcomeId
    if (market.outcomeType === "multi") {
      const outcome = market.outcomes.find(o => o.id === outcomeId)
      return outcome ? s.label === outcome.label : false
    }
    return false
  })
}

// Inverse of outcomeToSlotIdx: slot index → raw outcomeId string.
export function slotIdxToOutcomeId(idx: number, market: Market): string | null {
  if (idx < 0) return null
  if (market.outcomeType === "binary")  return idx === 0 ? "yes" : "no"
  if (market.outcomeType === "scalar")  return idx === 0 ? "higher" : "lower"
  return market.outcomes[idx]?.id ?? null
}

export function fmtAmt(n: number, decimals = 4): string {
  if (n === 0) return "0"
  if (n < 0.001) return n.toExponential(2)
  return n.toFixed(decimals).replace(/\.?0+$/, "")
}