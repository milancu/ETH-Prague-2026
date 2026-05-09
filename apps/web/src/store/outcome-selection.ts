import { create } from "zustand"

// Shared selection state keyed by marketId.
// slotIndex: 0-based index into getOutcomeSlots(); -1 = nothing selected.
// Both OrderBook tabs and TradingPanel outcome buttons read/write this store.

interface State {
  slotIndices: Record<string, number>
  setSlotIndex: (marketId: string, idx: number) => void
}

export const useOutcomeSelection = create<State>((set) => ({
  slotIndices: {},
  setSlotIndex: (marketId, idx) =>
    set((s) => ({ slotIndices: { ...s.slotIndices, [marketId]: idx } })),
}))