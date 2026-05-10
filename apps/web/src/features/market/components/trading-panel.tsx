import { useState, useMemo } from "react"
import { formatEther } from "viem"
import { useAccount, useReadContract } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { ERC20_ABI, TABCOIN_ADDRESS } from "@/lib/contracts"
import type { Market } from "@/features/market/types"
import { useOutcomeSelection } from "@/store/outcome-selection"
import { usePositionData } from "./trading-panel/use-position-data"
import {
  CATEGORY_BAR,
  NULL_SLOT_CTX,
  outcomeToSlotIdx,
  slotIdxToOutcomeId,
  slotPalette,
  type SlotContext,
} from "./trading-panel/shared"
import { OutcomeSelector } from "./trading-panel/outcome-selector"
import { TradeNowPanel } from "./trading-panel/trade-now-panel"
import { CreateOfferPanel } from "./trading-panel/create-offer-panel"
import { PositionsSection } from "./trading-panel/positions-section"
import { ClaimPanel } from "./trading-panel/claim-panel"

// ── Resolved market wrapper ───────────────────────────────────────────────────

function ResolvedPanel({ market }: { market: Market }) {
  return (
    <div className="flex flex-col border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Claim Winnings</span>
      </div>
      <div className="p-4">
        <ClaimPanel market={market} />
      </div>
    </div>
  )
}

// ── Unified trading panel ─────────────────────────────────────────────────────

function UnifiedTradingPanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const catBar = CATEGORY_BAR[market.category]

  const [mode, setMode] = useState<"trade" | "offer">("trade")
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const isTradeMode = mode === "trade"
  const isBuy = side === "buy"

  // ── Shared outcome selection (synced with OrderBook) ──────────────────────────
  const storeSlotIdx = useOutcomeSelection(s => s.slotIndices[market.id] ?? -1)
  const setSlotIndex = useOutcomeSelection(s => s.setSlotIndex)

  // ── Shared data ───────────────────────────────────────────────────────────────
  const { slots, erc20Balances, rawBalances, wrappers, refetch } = usePositionData(address, market)

  const { data: openOrders = [] } = useOrders(
    address && market.marketId != null ? { marketId: market.marketId, maker: address } : undefined,
  )

  const { data: tabBalanceRaw } = useReadContract({
    address: TABCOIN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, staleTime: 15_000 },
  })
  const tabBalanceNum = parseFloat(formatEther((tabBalanceRaw ?? 0n) as bigint))

  // ── Derive selected outcome ID from store slot index ──────────────────────────
  const selected = useMemo(
    () => slotIdxToOutcomeId(storeSlotIdx, market),
    [storeSlotIdx, market],
  )

  // ── Per-slot committed amounts (open sell orders) ─────────────────────────────
  const committedErc20 = useMemo(
    () => slots.map((_, i) => {
      const w = wrappers[i]
      if (!w) return 0n
      return openOrders.reduce((sum, o) => {
        if (o.makerToken.toLowerCase() === w.toLowerCase()) return sum + BigInt(o.makerAmount)
        return sum
      }, 0n)
    }),
    [openOrders, slots, wrappers],
  )
  const freeErc20 = erc20Balances.map((bal, i) => bal > committedErc20[i] ? bal - committedErc20[i] : 0n)

  // ── Selected slot context ─────────────────────────────────────────────────────
  const slotCtx = useMemo((): SlotContext => {
    if (!selected || storeSlotIdx < 0) return NULL_SLOT_CTX
    const idx = storeSlotIdx  // already resolved
    if (idx >= slots.length) return NULL_SLOT_CTX

    let label = selected.toUpperCase()
    if (market.outcomeType === "scalar") label = selected === "higher" ? "HIGHER" : "LOWER"
    if (market.outcomeType === "multi")  label = market.outcomes.find(o => o.id === selected)?.label ?? selected

    const erc20Total = erc20Balances[idx]
    const committed  = committedErc20[idx]
    const free       = freeErc20[idx]
    const freeNum    = parseFloat(formatEther(free))
    const rawNum     = parseFloat(formatEther(rawBalances[idx]))

    return {
      idx,
      selectedId: selected,
      label,
      wrapper: wrappers[idx],
      palette: slotPalette(idx, market),
      freeNum,
      rawNum,
      totalNum: freeNum + rawNum,
      erc20Total,
      committed,
    }
  }, [selected, storeSlotIdx, slots, market, erc20Balances, committedErc20, freeErc20, rawBalances, wrappers])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleSelectOutcome(v: string | null) {
    if (v === null) {
      setSlotIndex(market.id, -1)
    } else {
      const idx = outcomeToSlotIdx(v, slots, market)
      setSlotIndex(market.id, idx)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  // Key includes side so the form resets when side changes (quantity/price clear).
  const panelKey = `${slotCtx.selectedId || "none"}-${side}`

  return (
    <div className={cn(
      "flex flex-col border border-border border-t-2 bg-card/40",
      "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
      isBuy ? "border-t-sky-500/60" : "border-t-orange-500/60",
    )}>

      {/* Mode tabs — larger hit-area, more deliberate */}
      <div className="flex border-b border-border">
        {(["trade", "offer"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={cn(
              "flex-1 px-4 py-3.5 text-[11px] font-semibold uppercase tracking-widest",
              "transition-[background-color,color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              mode === m
                ? "bg-foreground/[0.04] text-foreground border-b-2 border-foreground/60 -mb-px"
                : "text-muted-foreground/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground/80",
            )}
          >
            {m === "trade" ? "Trade now" : "Create offer"}
          </button>
        ))}
      </div>

      {/* Buy / Sell — segmented, side-coloured. Hint sits underneath. */}
      <div className="flex flex-col gap-1.5 px-4 pt-4 pb-3 border-b border-border">
        <div role="group" aria-label="Trade direction" className="grid grid-cols-2 gap-1">
          {(["buy", "sell"] as const).map(s => {
            const active = side === s
            return (
              <button key={s} onClick={() => setSide(s)} aria-pressed={active}
                className={cn(
                  "py-2 text-[11px] font-bold uppercase tracking-widest",
                  "transition-[background-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? s === "buy"
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40"
                      : "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40"
                    : "bg-muted/40 text-muted-foreground/55 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground",
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/35">
          {isTradeMode ? "Fill order book instantly" : "Post limit order"}
        </span>
      </div>

      {/* Outcome selector — pb-2 lets the form merge as one card; pb-4 (= sides)
          when nothing follows (trade w/o pick) or a separate section does (offer's PositionsSection). */}
      <div className={cn(
        "px-4 pt-4",
        selected === null ? "pb-4" : "pb-2",
      )}>
        <OutcomeSelector market={market} catBar={catBar} selected={selected} onSelect={handleSelectOutcome} />
      </div>

      {/* Trade now panel */}
      {isTradeMode && selected !== null && (
        <TradeNowPanel key={panelKey} market={market} side={side} slotCtx={slotCtx} tabBalanceNum={tabBalanceNum} />
      )}

      {/* Create offer panel + positions (offer mode only) */}
      {!isTradeMode && (
        <>
          {selected !== null && (
            <CreateOfferPanel key={panelKey} market={market} side={side} slotCtx={slotCtx} tabBalanceNum={tabBalanceNum} />
          )}
          <div className={cn(selected !== null && "mt-2")}>
            <PositionsSection
              market={market}
              slots={slots}
              rawBalances={rawBalances}
              erc20Balances={erc20Balances}
              wrappers={wrappers}
              onRefetch={refetch}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props { market: Market }

export function TradingPanel({ market }: Props) {
  if (market.status === "resolved") return <ResolvedPanel market={market} />
  return <UnifiedTradingPanel market={market} />
}