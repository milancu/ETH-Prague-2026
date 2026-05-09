import { useState, useMemo } from "react"
import { parseEther, formatEther } from "viem"
import { useAccount, useReadContract, useReadContracts } from "wagmi"
import { ArrowRight, Layers } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/animate-ui/primitives/base/progress"
import { usePlaceOrder } from "@/features/orders/hooks/use-place-order"
import { useFillOrder } from "@/features/orders/hooks/use-fill-order"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { useSplit } from "@/features/market/hooks/use-split"
import { useWrap } from "@/features/market/hooks/use-wrap"
import { useClaimWinnings } from "@/features/market/hooks/use-claim-winnings"
import {
  getOutcomeSlots,
  getPositionId,
  formatBalance,
} from "@/features/positions/lib/utils"
import {
  CONDITIONAL_TOKENS_ABI,
  CONDITIONAL_TOKENS_ADDRESS,
  ERC20_ABI,
  FACTORY_ABI,
  POSITION_WRAPPER_FACTORY_ADDRESS,
  TABCOIN_ADDRESS,
} from "@/lib/contracts"
import type {
  BinaryMarket,
  Market,
  MarketCategory,
  MultiMarket,
  ScalarMarket,
} from "@/features/market/types"

// ── Slot color palette ────────────────────────────────────────────────────────

type SlotPalette = { text: string; bar: string; activeBg: string; ring: string; dot: string }

const BINARY_PALETTE: SlotPalette[] = [
  { text: "text-emerald-400", bar: "bg-emerald-500",    activeBg: "bg-emerald-500/10", ring: "ring-emerald-500/30", dot: "bg-emerald-400" },
  { text: "text-rose-400",    bar: "bg-rose-500",       activeBg: "bg-rose-500/10",    ring: "ring-rose-500/30",    dot: "bg-rose-400"    },
]
const MULTI_PALETTE: SlotPalette[] = [
  { text: "text-blue-400",   bar: "bg-blue-500",   activeBg: "bg-blue-500/10",   ring: "ring-blue-500/30",   dot: "bg-blue-400"   },
  { text: "text-violet-400", bar: "bg-violet-500", activeBg: "bg-violet-500/10", ring: "ring-violet-500/30", dot: "bg-violet-400" },
  { text: "text-amber-400",  bar: "bg-amber-500",  activeBg: "bg-amber-500/10",  ring: "ring-amber-500/30",  dot: "bg-amber-400"  },
  { text: "text-cyan-400",   bar: "bg-cyan-500",   activeBg: "bg-cyan-500/10",   ring: "ring-cyan-500/30",   dot: "bg-cyan-400"   },
]

function slotPalette(index: number, market: Market): SlotPalette {
  if (market.outcomeType === "binary" || market.outcomeType === "scalar")
    return BINARY_PALETTE[index % 2]
  return MULTI_PALETTE[index % MULTI_PALETTE.length]
}

const CATEGORY_BAR: Record<MarketCategory, string> = {
  Finance: "bg-amber-500/60", Politics: "bg-blue-500/60",
  Sport:   "bg-emerald-500/60", Czech: "bg-purple-500/60",
  Weather: "bg-cyan-500/60",
}

// ── Outcome selectors (BUY / SELL tabs) ───────────────────────────────────────

function BinarySelector({ market, selected, onSelect }: {
  market: BinaryMarket; selected: string | null; onSelect: (v: string | null) => void
}) {
  const sides = [
    { id: "yes", label: "YES", price: market.yesPrice, ...BINARY_PALETTE[0] },
    { id: "no",  label: "NO",  price: market.noPrice,  ...BINARY_PALETTE[1] },
  ] as const
  return (
    <div className="flex flex-col gap-1">
      {sides.map(({ id, label, price, activeBg, ring, bar, text }) => {
        const active = selected === id
        return (
          <button key={id} aria-pressed={active}
            onClick={() => onSelect(active ? null : id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
            )}
          >
            <span className={cn("w-7 shrink-0 text-[11px] font-bold tracking-widest", text)}>{label}</span>
            <Progress value={price} className="flex-1">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", bar)} />
              </ProgressTrack>
            </Progress>
            <span className={cn("w-10 shrink-0 text-right text-xs font-bold tabular-nums", text)}>{price}%</span>
          </button>
        )
      })}
    </div>
  )
}

function MultiSelector({ market, catBar, selected, onSelect }: {
  market: MultiMarket; catBar: string; selected: string | null; onSelect: (v: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {market.outcomes.map((outcome, i) => {
        const active = selected === outcome.id
        const pal = MULTI_PALETTE[i % MULTI_PALETTE.length]
        return (
          <button key={outcome.id} aria-pressed={active}
            onClick={() => onSelect(active ? null : outcome.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              active ? cn(pal.activeBg, "ring-1", pal.ring) : "bg-muted hover:bg-muted/60",
            )}
          >
            <Progress value={outcome.price} className="flex-1">
              <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
                <ProgressIndicator className={cn("h-full", catBar)} />
              </ProgressTrack>
            </Progress>
            <span className="shrink-0 text-xs font-medium text-foreground">{outcome.label}</span>
            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{outcome.price}%</span>
          </button>
        )
      })}
    </div>
  )
}

function ScalarSelector({ market, selected, onSelect }: {
  market: ScalarMarket; selected: string | null; onSelect: (v: string | null) => void
}) {
  const range = market.scalarMax - market.scalarMin
  const pct = range === 0 ? 0 : ((market.currentValue - market.scalarMin) / range) * 100
  const sides = [
    { id: "higher", label: "HIGHER", hint: `> ${market.currentValue} ${market.scalarUnit}`, ...BINARY_PALETTE[0] },
    { id: "lower",  label: "LOWER",  hint: `< ${market.currentValue} ${market.scalarUnit}`, ...BINARY_PALETTE[1] },
  ] as const
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="uppercase tracking-widest text-muted-foreground">Consensus</span>
          <span className="font-semibold tabular-nums text-foreground">{market.currentValue} {market.scalarUnit}</span>
        </div>
        <Progress value={pct}>
          <ProgressTrack className="h-1 w-full overflow-hidden bg-white/8">
            <ProgressIndicator className="h-full bg-primary/70" />
          </ProgressTrack>
        </Progress>
      </div>
      <div className="flex flex-col gap-1">
        {sides.map(({ id, label, hint, activeBg, ring, text }) => {
          const active = selected === id
          return (
            <button key={id} aria-pressed={active}
              onClick={() => onSelect(active ? null : id)}
              className={cn(
                "flex items-center justify-between px-3 py-2",
                "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                active ? cn(activeBg, "ring-1", ring) : "bg-muted hover:bg-muted/60",
              )}
            >
              <span className={cn("text-[11px] font-bold tracking-widest", text)}>{label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Amount input ──────────────────────────────────────────────────────────────

function AmountInput({ value, onChange, unit, label, disabled }: {
  value: string; onChange: (v: string) => void
  unit: string; label: string; disabled?: boolean
}) {
  return (
    <div className="relative flex-1">
      <Input type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" min="0" aria-label={label} className="pr-12" disabled={disabled} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        {unit}
      </span>
    </div>
  )
}

// ── Position data hook ────────────────────────────────────────────────────────

function usePositionData(address: `0x${string}` | undefined, market: Market) {
  const slots = useMemo(() => getOutcomeSlots(market), [market])
  const conditionId = market.conditionId as `0x${string}`

  // ERC-1155 raw balances
  const { data: rawData, refetch: refetchRaw } = useReadContracts({
    contracts: address
      ? slots.map(({ indexSet }) => ({
          address: CONDITIONAL_TOKENS_ADDRESS,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "balanceOf" as const,
          args: [address, getPositionId(conditionId, indexSet)] as const,
        }))
      : [],
    query: { enabled: !!address, staleTime: 10_000 },
  })

  // Wrapper addresses from factory
  const { data: wrapperData, refetch: refetchWrappers } = useReadContracts({
    contracts: slots.map(({ indexSet }) => ({
      address: POSITION_WRAPPER_FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "getWrapper" as const,
      args: [TABCOIN_ADDRESS, conditionId, indexSet] as const,
    })),
    query: { staleTime: 20_000 },
  })

  const wrappers = slots.map((_, i) => {
    const w = wrapperData?.[i]?.result as `0x${string}` | undefined
    return w && BigInt(w) !== 0n ? w : null
  })

  // ERC-20 wrapped balances — only query slots where wrapper exists
  const existingWrapperContracts = address
    ? wrappers.flatMap((w, i) =>
        w ? [{ slotIndex: i, contract: { address: w, abi: ERC20_ABI, functionName: "balanceOf" as const, args: [address] as const } }] : []
      )
    : []

  const { data: erc20Data, refetch: refetchErc20 } = useReadContracts({
    contracts: existingWrapperContracts.map(x => x.contract),
    query: { enabled: !!address && existingWrapperContracts.length > 0, staleTime: 10_000 },
  })

  // Map ERC-20 results back to slot indices
  const erc20Balances = slots.map((_, slotIdx) => {
    const idx = existingWrapperContracts.findIndex(x => x.slotIndex === slotIdx)
    if (idx < 0) return 0n
    return (erc20Data?.[idx]?.result ?? 0n) as bigint
  })

  function refetch() {
    refetchRaw()
    refetchWrappers()
    refetchErc20()
  }

  return {
    slots,
    rawBalances: slots.map((_, i) => (rawData?.[i]?.result ?? 0n) as bigint),
    erc20Balances,
    wrappers,
    refetch,
  }
}

// ── Claim panel (resolved market) ─────────────────────────────────────────────

function ClaimPanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const { slots, rawBalances } = usePositionData(address, market)
  const { claimWinnings, isPending } = useClaimWinnings()

  const claimable = slots.filter((_, i) => rawBalances[i] > 0n)

  async function handleClaim() {
    try { await claimWinnings(market, claimable.map(s => s.indexSet)) }
    catch { /* toast handled */ }
  }

  if (!address) return (
    <p className="text-xs text-muted-foreground py-2">Connect wallet to claim winnings.</p>
  )
  if (claimable.length === 0) return (
    <p className="text-xs text-muted-foreground py-2">No positions to claim for this market.</p>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        {claimable.map((slot) => {
          const pal = slotPalette(slots.indexOf(slot), market)
          return (
            <div key={slot.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className={cn("text-xs font-bold tracking-wide", pal.text)}>{slot.label}</span>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {formatBalance(rawBalances[slots.indexOf(slot)])}
              </span>
            </div>
          )
        })}
      </div>
      <Button onClick={handleClaim} disabled={isPending} className="self-start">
        {isPending ? "Claiming…" : "Claim All Winnings"}
      </Button>
    </div>
  )
}

// ── Mint panel ────────────────────────────────────────────────────────────────

function PositionRow({ label, raw, wrapped, wrapperExists, palette, isWrapping, onWrap }: {
  label: string
  raw: bigint
  wrapped: bigint
  wrapperExists: boolean
  palette: SlotPalette
  isWrapping: boolean
  onWrap: () => void
}) {
  const hasRaw     = raw > 0n
  const hasWrapped = wrapped > 0n
  // first-ever wrap for this outcome needs up to 3 txs; subsequent wraps need 1
  const stepsHint  = !wrapperExists ? "3 txs" : "1 tx"

  return (
    <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 py-3 border-b border-border/40 last:border-0">
      {/* Outcome label */}
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", palette.dot)} aria-hidden />
        <span className={cn("text-[11px] font-bold tracking-widest", palette.text)}>{label}</span>
      </div>

      {/* ERC-1155 (raw) */}
      <span className={cn(
        "text-right font-mono text-xs tabular-nums",
        hasRaw ? "text-foreground" : "text-muted-foreground/25",
      )}>
        {hasRaw ? formatBalance(raw) : "—"}
      </span>

      {/* Wrap action */}
      <div className="flex flex-col items-center gap-0.5">
        {hasRaw ? (
          <>
            <button
              onClick={onWrap}
              disabled={isWrapping}
              aria-label={`Wrap ${label} to ERC-20 (${stepsHint})`}
              className={cn(
                "flex items-center justify-center gap-0.5 w-full py-1",
                "text-[10px] font-bold tracking-wide",
                "border border-border/60 hover:border-foreground/30",
                "text-muted-foreground/50 hover:text-foreground",
                "transition-colors duration-100 active:scale-[0.97]",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              {isWrapping
                ? <span className="animate-pulse">…</span>
                : <ArrowRight className="size-3" aria-hidden />
              }
            </button>
            <span className="text-[8px] text-muted-foreground/30 tabular-nums">{stepsHint}</span>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/15 text-center w-full">→</span>
        )}
      </div>

      {/* ERC-20 (tradeable) */}
      <span className={cn(
        "text-right font-mono text-xs tabular-nums",
        hasWrapped ? cn("font-semibold", palette.text) : "text-muted-foreground/25",
      )}>
        {hasWrapped ? formatBalance(wrapped) : "—"}
      </span>
    </div>
  )
}

function MintPanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const [mintAmount, setMintAmount] = useState("")
  const { split, isPending: splitting } = useSplit()
  const { wrap, wrapping } = useWrap()

  const { slots, rawBalances, erc20Balances, wrappers, refetch } = usePositionData(address, market)

  const hasAnyPosition = rawBalances.some(b => b > 0n) || erc20Balances.some(b => b > 0n)
  const mintPreviewAmt = parseFloat(mintAmount) > 0 ? mintAmount : null

  async function handleMint() {
    if (!mintAmount || Number(mintAmount) <= 0) return
    try {
      await split({ market, tabAmountWei: parseEther(mintAmount) })
      setMintAmount("")
      refetch()
    } catch { /* toast handled */ }
  }

  async function handleWrap(i: number) {
    const raw = rawBalances[i]
    if (raw === 0n) return
    try {
      await wrap({ market, indexSet: slots[i].indexSet, amount: raw })
      refetch()
    } catch { /* toast handled */ }
  }

  return (
    <div className="flex flex-col border border-border">
      {/* ── Card header ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Layers className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Positions
        </span>
      </div>

      {/* ── Positions table ── */}
      <div className="border-b border-border">

        {!address ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">
            Connect wallet to see positions.
          </p>
        ) : !hasAnyPosition ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">
            No positions yet — mint below to get started.
          </p>
        ) : (
          <>
            {/* Column headers */}
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-1.5">
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">
                ERC-1155
              </span>
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">
                ERC-20
              </span>
            </div>
            {/* Sub-labels */}
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-2">
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">raw · illiquid</span>
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">tradeable</span>
            </div>
            {/* Rows */}
            {slots.map((slot, i) => (
              <PositionRow
                key={slot.label}
                label={slot.label}
                raw={rawBalances[i]}
                wrapped={erc20Balances[i]}
                wrapperExists={wrappers[i] !== null}
                palette={slotPalette(i, market)}
                isWrapping={wrapping === slot.indexSet}
                onWrap={() => handleWrap(i)}
              />
            ))}
          </>
        )}
      </div>

      {/* ── Mint new ── */}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Mint New
          </span>
          <span className="text-[10px] text-muted-foreground/50">· 1:1 ratio</span>
        </div>

        <div className="flex gap-2">
          <AmountInput
            value={mintAmount}
            onChange={setMintAmount}
            unit="TAB"
            label="TABcoin to split into positions"
            disabled={splitting}
          />
          <Button
            onClick={handleMint}
            disabled={Number(mintAmount) <= 0 || splitting}
            className="shrink-0"
          >
            {splitting ? "Minting…" : "Mint"}
          </Button>
        </div>

        {/* Preview */}
        {mintPreviewAmt && (
          <div className="flex flex-wrap items-center gap-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            <span className="text-[10px] text-muted-foreground/60">You receive</span>
            {slots.map((slot, i) => {
              const pal = slotPalette(i, market)
              return (
                <span key={slot.label} className="flex items-center gap-1">
                  <span className={cn("font-mono text-[11px] font-semibold tabular-nums", pal.text)}>
                    {mintPreviewAmt}
                  </span>
                  <span className={cn("text-[10px] font-bold tracking-wide", pal.text)}>
                    {slot.label}
                  </span>
                  {i < slots.length - 1 && (
                    <span className="text-muted-foreground/40 text-[10px] mx-0.5">+</span>
                  )}
                </span>
              )
            })}
            <span className="text-[10px] text-muted-foreground/40 ml-0.5">(raw ERC-1155)</span>
          </div>
        )}

        {/* Explainer */}
        <p className="text-[10px] leading-relaxed text-muted-foreground/50">
          Raw tokens are not tradeable on the order book.{" "}
          Use <strong className="text-muted-foreground/70 font-semibold">Wrap →</strong> above
          to convert to ERC-20 for trading.
        </p>
      </div>
    </div>
  )
}

// ── Helper: map outcomeId → slot index ───────────────────────────────────────

function outcomeToSlotIdx(
  outcomeId: string,
  slots: ReturnType<typeof getOutcomeSlots>,
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

// ── MakerPanel (offers + positions + mint in one card) ───────────────────────

function MakerPanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const catBar = CATEGORY_BAR[market.category]

  // ── Offer state ───────────────────────────────────────────────────────────────
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [selected, setSelected] = useState<string | null>(null)
  const [quantity, setQuantity] = useState("")
  const [price, setPrice] = useState("")
  const { placeOrder, isPending: placeIsPending } = usePlaceOrder()
  const isBuy = side === "buy"

  // ── Mint state ────────────────────────────────────────────────────────────────
  const [mintAmount, setMintAmount] = useState("")
  const { split, isPending: splitting } = useSplit()
  const { wrap, wrapping } = useWrap()

  // ── Shared: position data ─────────────────────────────────────────────────────
  const { slots, erc20Balances, rawBalances, wrappers, refetch } = usePositionData(address, market)
  const hasAnyPosition = rawBalances.some(b => b > 0n) || erc20Balances.some(b => b > 0n)
  const mintPreviewAmt = parseFloat(mintAmount) > 0 ? mintAmount : null

  // ── BUY: TAB balance ──────────────────────────────────────────────────────────
  const { data: tabBalanceRaw } = useReadContract({
    address: TABCOIN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, staleTime: 15_000 },
  })
  const tabBalance = (tabBalanceRaw ?? 0n) as bigint

  // ── SELL: committed amounts ───────────────────────────────────────────────────
  const { data: openOrders = [] } = useOrders(
    address && market.marketId != null
      ? { marketId: market.marketId, maker: address }
      : undefined,
  )
  const committedErc20 = useMemo(
    () =>
      slots.map((_, i) => {
        const wrapper = wrappers[i]
        if (!wrapper) return 0n
        return openOrders.reduce((sum, order) => {
          if (order.makerToken.toLowerCase() === wrapper.toLowerCase())
            return sum + BigInt(order.makerAmount)
          return sum
        }, 0n)
      }),
    [openOrders, slots, wrappers],
  )
  const freeErc20 = erc20Balances.map((bal, i) => {
    const committed = committedErc20[i]
    return bal > committed ? bal - committed : 0n
  })

  // ── Selected slot ──────────────────────────────────────────────────────────────
  const selectedSlotIdx = useMemo(
    () => (selected ? outcomeToSlotIdx(selected, slots, market) : -1),
    [selected, slots, market],
  )
  const selectedErc20     = selectedSlotIdx >= 0 ? erc20Balances[selectedSlotIdx]  : 0n
  const selectedFree      = selectedSlotIdx >= 0 ? freeErc20[selectedSlotIdx]      : 0n
  const selectedCommitted = selectedSlotIdx >= 0 ? committedErc20[selectedSlotIdx] : 0n
  const selectedRaw       = selectedSlotIdx >= 0 ? rawBalances[selectedSlotIdx]    : 0n
  const totalTabWei = useMemo(() => {
    const q = parseFloat(quantity)
    const p = parseFloat(price)
    if (q > 0 && p > 0) return parseEther(String(Math.round(q * p * 1e6) / 1e6))
    return 0n
  }, [quantity, price])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function switchSide(s: "buy" | "sell") {
    setSide(s)
    setQuantity("")
    setPrice("")
  }

  async function handlePlaceOrder() {
    if (!selected || Number(quantity) <= 0 || Number(price) <= 0) return
    try {
      await placeOrder({
        market, outcomeId: selected, side,
        quantityWei: parseEther(quantity),
        priceWei: parseEther(price),
      })
      setQuantity("")
      setPrice("")
    } catch { /* toast handled */ }
  }

  async function handleMint() {
    if (!mintAmount || Number(mintAmount) <= 0) return
    try {
      await split({ market, tabAmountWei: parseEther(mintAmount) })
      setMintAmount("")
      refetch()
    } catch { /* toast handled */ }
  }

  async function handleWrap(i: number) {
    const raw = rawBalances[i]
    if (raw === 0n) return
    try {
      await wrap({ market, indexSet: slots[i].indexSet, amount: raw })
      refetch()
    } catch { /* toast handled */ }
  }

  return (
    <div
      className={cn(
        "flex flex-col border border-border border-t-2",
        "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
        isBuy ? "border-t-emerald-500/50" : "border-t-rose-500/50",
      )}
    >
      {/* ── Offer header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Create offer
        </span>
        <div role="group" aria-label="Offer side" className="flex items-center gap-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => switchSide(s)}
              aria-pressed={side === s}
              className={cn(
                "px-3 py-1 text-[11px] font-bold uppercase tracking-widest",
                "transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                side === s
                  ? s === "buy"
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25"
                    : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/25"
                  : "text-muted-foreground/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Outcome selector ── */}
      <div className="p-4">
        {market.outcomeType === "binary" && (
          <BinarySelector market={market} selected={selected}
            onSelect={v => { setSelected(v); setQuantity(""); setPrice("") }} />
        )}
        {market.outcomeType === "multi" && (
          <MultiSelector market={market} catBar={catBar} selected={selected}
            onSelect={v => { setSelected(v); setQuantity(""); setPrice("") }} />
        )}
        {market.outcomeType === "scalar" && (
          <ScalarSelector market={market} selected={selected}
            onSelect={v => { setSelected(v); setQuantity(""); setPrice("") }} />
        )}
      </div>

      {/* ── Offer form ── */}
      {selected !== null && (
        <div className={cn(
          "flex flex-col gap-3 px-4 pb-4",
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[98%]",
          "motion-safe:duration-150 motion-safe:fill-mode-both",
          "motion-safe:[animation-timing-function:cubic-bezier(0.23,1,0.32,1)]",
        )}>
          {!isBuy && address && selectedErc20 > 0n && (
            <div className="flex flex-col divide-y divide-border/40 border border-border/40 bg-muted/30">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-semibold">Free</span>
                <span className="font-mono text-xs tabular-nums text-foreground font-semibold">{formatBalance(selectedFree)}</span>
              </div>
              {selectedCommitted > 0n && (
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40">In open offers</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/50">{formatBalance(selectedCommitted)}</span>
                </div>
              )}
              {selectedRaw > 0n && (
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground/30">Raw (unwrapped)</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/30">{formatBalance(selectedRaw)}</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">Tokens</span>
                {!isBuy && selectedFree > 0n && (
                  <button onClick={() => setQuantity(formatEther(selectedFree))}
                    aria-label="Set quantity to max free balance"
                    className="text-[9px] uppercase tracking-wider font-semibold active:scale-[0.97] text-primary/50 transition-colors duration-100 [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary">
                    MAX
                  </button>
                )}
              </div>
              <AmountInput value={quantity} onChange={setQuantity} unit="tok" label="Number of outcome tokens" disabled={placeIsPending} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
                {isBuy ? "Max" : "Min"} price / token
              </span>
              <AmountInput value={price} onChange={setPrice} unit="TAB" label="Price per token in TAB" disabled={placeIsPending} />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            {totalTabWei > 0n ? (
              <span className="text-muted-foreground">
                {isBuy ? "Total spend" : "You receive"}{" "}
                <span className="font-mono font-semibold text-foreground tabular-nums">{formatEther(totalTabWei)} TAB</span>
              </span>
            ) : <span />}
            <span className="text-[10px] text-muted-foreground/50">
              {isBuy
                ? address && tabBalance > 0n ? `Balance: ${formatBalance(tabBalance)} TAB` : null
                : selectedRaw > 0n && selectedErc20 === 0n ? <span className="text-amber-400/70">Wrap tokens first ↓</span> : null
              }
            </span>
          </div>

          <Button
            onClick={handlePlaceOrder}
            disabled={Number(quantity) <= 0 || Number(price) <= 0 || placeIsPending || (!isBuy && selectedFree === 0n)}
            className="w-full active:scale-[0.97] transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            {placeIsPending ? "Posting…" : !isBuy && selectedFree === 0n ? "No free tokens" : isBuy ? "Create buy offer" : "Create sell offer"}
          </Button>
        </div>
      )}

      {/* ── Positions table ── */}
      <div className="border-t border-border">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Layers className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Positions</span>
        </div>

        {!address ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">Connect wallet to see positions.</p>
        ) : !hasAnyPosition ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">No positions yet — mint below.</p>
        ) : (
          <>
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-1.5">
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">ERC-1155</span>
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">ERC-20</span>
            </div>
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-2">
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">raw · illiquid</span>
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">tradeable</span>
            </div>
            {slots.map((slot, i) => (
              <PositionRow key={slot.label} label={slot.label}
                raw={rawBalances[i]} wrapped={erc20Balances[i]}
                wrapperExists={wrappers[i] !== null}
                palette={slotPalette(i, market)}
                isWrapping={wrapping === slot.indexSet}
                onWrap={() => handleWrap(i)} />
            ))}
          </>
        )}
      </div>

      {/* ── Mint ── */}
      <div className="flex flex-col gap-3 border-t border-border p-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Mint</span>
          <span className="text-[10px] text-muted-foreground/40">· 1 TAB → 1 YES + 1 NO</span>
        </div>

        <div className="flex gap-2">
          <AmountInput value={mintAmount} onChange={setMintAmount} unit="TAB" label="TABcoin to split into positions" disabled={splitting} />
          <Button onClick={handleMint} disabled={Number(mintAmount) <= 0 || splitting} className="shrink-0 active:scale-[0.97]">
            {splitting ? "Minting…" : "Mint"}
          </Button>
        </div>

        {mintPreviewAmt && (
          <div className="flex flex-wrap items-center gap-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            <span className="text-[10px] text-muted-foreground/60">You receive</span>
            {slots.map((slot, i) => {
              const pal = slotPalette(i, market)
              return (
                <span key={slot.label} className="flex items-center gap-1">
                  <span className={cn("font-mono text-[11px] font-semibold tabular-nums", pal.text)}>{mintPreviewAmt}</span>
                  <span className={cn("text-[10px] font-bold tracking-wide", pal.text)}>{slot.label}</span>
                  {i < slots.length - 1 && <span className="text-muted-foreground/40 text-[10px] mx-0.5">+</span>}
                </span>
              )
            })}
            <span className="text-[10px] text-muted-foreground/40">(ERC-1155)</span>
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground/40">
          Raw tokens can&apos;t be traded — use <strong className="text-muted-foreground/60">Wrap →</strong> above to convert.
        </p>
      </div>
    </div>
  )
}

// ── DirectTradePanel (fill existing orders from the book) ─────────────────────

const TAB_LC = TABCOIN_ADDRESS.toLowerCase()

function DirectTradePanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const [side, setSide] = useState<"buy" | "sell">("buy")
  const [selected, setSelected] = useState<string | null>(null)
  // BUY: TAB to spend; SELL: tokens to sell
  const [amount, setAmount] = useState("")
  const { fillOrder, isPending } = useFillOrder()
  const catBar = CATEGORY_BAR[market.category]
  const isBuy = side === "buy"

  // All orders for this market (no maker filter — we need everyone's orders)
  const { data: allOrders = [] } = useOrders(
    market.marketId != null ? { marketId: market.marketId } : undefined,
  )

  // Wrapper addresses per slot (needed to match orders to outcomes)
  const { slots, wrappers } = usePositionData(address, market)

  // Map selected outcome → wrapper address
  const selectedSlotIdx = useMemo(
    () => (selected ? outcomeToSlotIdx(selected, slots, market) : -1),
    [selected, slots, market],
  )
  const selectedWrapper = selectedSlotIdx >= 0 ? wrappers[selectedSlotIdx] : null

  // Best order to fill for the current side + outcome
  const bestOrder = useMemo(() => {
    if (!selectedWrapper) return null
    const wLC = selectedWrapper.toLowerCase()

    if (isBuy) {
      // Want to BUY tokens → fill a SELL order (makerToken = wrapper, takerToken = TAB)
      const asks = allOrders.filter(
        o => o.makerToken.toLowerCase() === wLC && o.takerToken.toLowerCase() === TAB_LC,
      )
      if (!asks.length) return null
      // Best ask = lowest price (cheapest tokens); compare cross-multiplied to avoid float
      return asks.reduce((best, o) =>
        BigInt(o.takerAmount) * BigInt(best.makerAmount) <
        BigInt(best.takerAmount) * BigInt(o.makerAmount) ? o : best,
      )
    } else {
      // Want to SELL tokens → fill a BUY order (makerToken = TAB, takerToken = wrapper)
      const bids = allOrders.filter(
        o => o.makerToken.toLowerCase() === TAB_LC && o.takerToken.toLowerCase() === wLC,
      )
      if (!bids.length) return null
      // Best bid = highest price; compare cross-multiplied
      return bids.reduce((best, o) =>
        BigInt(o.makerAmount) * BigInt(best.takerAmount) >
        BigInt(best.makerAmount) * BigInt(o.takerAmount) ? o : best,
      )
    }
  }, [allOrders, selectedWrapper, isBuy])

  // Price per token as a plain float (TAB per 1 token), for display only
  const pricePerToken = useMemo(() => {
    if (!bestOrder) return null
    const ma = Number(bestOrder.makerAmount)
    const ta = Number(bestOrder.takerAmount)
    return isBuy ? ta / ma : ma / ta
  }, [bestOrder, isBuy])

  // Max tokens available in the best order
  const maxTokens = useMemo(() => {
    if (!bestOrder) return 0
    return isBuy
      ? Number(bestOrder.makerAmount) / 1e18   // SELL order offers this many tokens
      : Number(bestOrder.takerAmount) / 1e18   // BUY order wants this many tokens
  }, [bestOrder, isBuy])

  const amountFloat = parseFloat(amount)

  // Derived amounts (capped at order size)
  const { tokensFilled, tabValue } = useMemo(() => {
    if (!pricePerToken || amountFloat <= 0) return { tokensFilled: 0, tabValue: 0 }
    if (isBuy) {
      // amount = TAB to spend → tokens = TAB / price
      const tokens = Math.min(amountFloat / pricePerToken, maxTokens)
      return { tokensFilled: tokens, tabValue: tokens * pricePerToken }
    } else {
      // amount = tokens to sell → TAB = tokens * price
      const tokens = Math.min(amountFloat, maxTokens)
      return { tokensFilled: tokens, tabValue: tokens * pricePerToken }
    }
  }, [amountFloat, pricePerToken, maxTokens, isBuy])

  async function handleTrade() {
    if (!bestOrder || amountFloat <= 0) return
    try {
      let fillMakerAmount: bigint
      if (isBuy) {
        // Fill SELL order: fillMakerAmount = tokens to pull from maker
        fillMakerAmount = parseEther(tokensFilled.toFixed(6))
      } else {
        // Fill BUY order: fillMakerAmount = TAB to pull from maker
        const tokensWei = parseEther(tokensFilled.toFixed(6))
        fillMakerAmount = BigInt(bestOrder.makerAmount) * tokensWei / BigInt(bestOrder.takerAmount)
      }
      await fillOrder(bestOrder, fillMakerAmount)
      setAmount("")
    } catch { /* toast handled */ }
  }

  const exceedsOrder = isBuy
    ? amountFloat / (pricePerToken ?? 1) > maxTokens
    : amountFloat > maxTokens

  return (
    <div className="flex flex-col border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Trade
        </span>
        <div role="group" aria-label="Trade side" className="flex items-center gap-0.5">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setSide(s); setAmount(""); setSelected(null) }}
              aria-pressed={side === s}
              className={cn(
                "px-3 py-1 text-[11px] font-bold uppercase tracking-widest",
                "transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                side === s
                  ? s === "buy"
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25"
                    : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/25"
                  : "text-muted-foreground/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-muted-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Outcome selector */}
      <div className="p-4">
        {market.outcomeType === "binary" && (
          <BinarySelector market={market} selected={selected}
            onSelect={v => { setSelected(v); setAmount("") }} />
        )}
        {market.outcomeType === "multi" && (
          <MultiSelector market={market} catBar={catBar} selected={selected}
            onSelect={v => { setSelected(v); setAmount("") }} />
        )}
        {market.outcomeType === "scalar" && (
          <ScalarSelector market={market} selected={selected}
            onSelect={v => { setSelected(v); setAmount("") }} />
        )}
      </div>

      {/* Form */}
      {selected !== null && (
        <div className={cn(
          "flex flex-col gap-3 px-4 pb-4",
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[98%]",
          "motion-safe:duration-150 motion-safe:fill-mode-both",
          "motion-safe:[animation-timing-function:cubic-bezier(0.23,1,0.32,1)]",
        )}>
          {bestOrder === null ? (
            <p className="text-[11px] text-muted-foreground/50 py-1">
              No {isBuy ? "sell" : "buy"} offers in the book for this outcome.
            </p>
          ) : (
            <>
              {/* Best price indicator */}
              <div className="flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-widest text-muted-foreground/60">
                  Best {isBuy ? "ask" : "bid"}
                </span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {pricePerToken != null ? `${(pricePerToken * 100).toFixed(1)}¢` : "—"}
                  <span className="text-muted-foreground/40 font-normal"> / token</span>
                </span>
              </div>

              <AmountInput
                value={amount}
                onChange={setAmount}
                unit={isBuy ? "TAB" : "tok"}
                label={isBuy ? "TAB to spend" : "Tokens to sell"}
                disabled={isPending}
              />

              {tokensFilled > 0 && (
                <div className="flex items-center justify-between text-[11px] px-0.5">
                  <span className="text-muted-foreground">
                    {isBuy ? "You get ≈" : "You receive ≈"}{" "}
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {isBuy
                        ? `${tokensFilled.toFixed(4)} tokens`
                        : `${tabValue.toFixed(4)} TAB`}
                    </span>
                  </span>
                  {exceedsOrder && (
                    <span className="text-[10px] text-amber-400/70">
                      capped at {maxTokens.toFixed(2)} tok
                    </span>
                  )}
                </div>
              )}

              <Button
                onClick={handleTrade}
                disabled={amountFloat <= 0 || isPending || tokensFilled <= 0}
                className="w-full active:scale-[0.97] transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)]"
              >
                {isPending ? "Filling…" : isBuy ? "Buy tokens" : "Sell tokens"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main trading panel ────────────────────────────────────────────────────────

interface Props {
  market: Market
}

export function TradingPanel({ market }: Props) {
  if (market.status === "resolved") {
    return (
      <div className="flex flex-col border border-border">
        <div className="border-b border-border px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Claim Winnings
          </span>
        </div>
        <div className="p-4">
          <ClaimPanel market={market} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <DirectTradePanel market={market} />
      <MakerPanel market={market} />
    </div>
  )
}