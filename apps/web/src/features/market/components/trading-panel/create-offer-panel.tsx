import { useMemo, useState } from "react"
import { formatEther, parseEther } from "viem"
import { Minus, Plus } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { usePlaceOrder } from "@/features/orders/hooks/use-place-order"
import type { Market } from "@/features/market/types"
import type { SlotContext } from "./shared"
import { fmtAmt, TAB_LC } from "./shared"
import { AmountInput, InlineWarn, TxReceipt } from "./components"

interface Props {
  market: Market
  side: "buy" | "sell"
  slotCtx: SlotContext
  tabBalanceNum: number
}

export function CreateOfferPanel({
  market,
  side,
  slotCtx,
  tabBalanceNum,
}: Props) {
  const isBuy = side === "buy"
  const {
    label,
    wrapper,
    palette,
    freeNum,
    rawNum,
    totalNum,
    erc20Total,
    committed,
  } = slotCtx

  const [quantity, setQuantity] = useState("")
  const [price, setPrice] = useState("")
  const [total, setTotal] = useState("")

  const { data: allOrders = [] } = useOrders(
    market.marketId != null ? { marketId: market.marketId } : undefined
  )
  const { placeOrder, isPending } = usePlaceOrder()

  // ── Best market price hint ────────────────────────────────────────────────────
  const bestMarketPrice = useMemo(() => {
    if (!wrapper) return null
    const wLC = wrapper.toLowerCase()
    if (isBuy) {
      // best ASK = lowest sell offer
      const asks = allOrders.filter(
        (o) =>
          o.makerToken.toLowerCase() === wLC &&
          o.takerToken.toLowerCase() === TAB_LC
      )
      if (!asks.length) return null
      const best = asks.reduce((b, o) =>
        Number(o.takerAmount) / Number(o.makerAmount) <
        Number(b.takerAmount) / Number(b.makerAmount)
          ? o
          : b
      )
      return Number(best.takerAmount) / Number(best.makerAmount)
    } else {
      // best BID = highest buy offer
      const bids = allOrders.filter(
        (o) =>
          o.makerToken.toLowerCase() === TAB_LC &&
          o.takerToken.toLowerCase() === wLC
      )
      if (!bids.length) return null
      const best = bids.reduce((b, o) =>
        Number(o.makerAmount) / Number(o.takerAmount) >
        Number(b.makerAmount) / Number(b.takerAmount)
          ? o
          : b
      )
      return Number(best.makerAmount) / Number(best.takerAmount)
    }
  }, [allOrders, wrapper, isBuy])

  // ── Linked input handlers ─────────────────────────────────────────────────────
  const priceFieldNum = parseFloat(price) || 0
  const quantityNum = parseFloat(quantity) || 0

  function handleQuantityChange(val: string) {
    setQuantity(val)
    const q = parseFloat(val)
    if (priceFieldNum > 0 && q > 0) setTotal((q * priceFieldNum).toFixed(4))
    else if (!val) setTotal("")
  }

  function handleTotalChange(val: string) {
    setTotal(val)
    const t = parseFloat(val)
    if (priceFieldNum > 0 && t > 0) setQuantity((t / priceFieldNum).toFixed(4))
    else if (!val) setQuantity("")
  }

  function handlePriceChange(val: string) {
    setPrice(val)
    const p = parseFloat(val)
    if (p > 0 && quantityNum > 0) setTotal((quantityNum * p).toFixed(4))
  }

  function adjustPrice(delta: number) {
    const base = priceFieldNum > 0 ? priceFieldNum : 0.5
    const next = Math.max(0.001, Math.min(0.999, base + delta))
    handlePriceChange(next.toFixed(3))
  }

  // ── Validation ────────────────────────────────────────────────────────────────
  const priceOverOne = priceFieldNum > 1
  const priceNegative = priceFieldNum < 0

  const insufficientTab =
    isBuy &&
    quantityNum > 0 &&
    priceFieldNum > 0 &&
    quantityNum * priceFieldNum > tabBalanceNum
  const sellExceedsFree =
    !isBuy && quantityNum > freeNum && quantityNum <= totalNum
  const sellExceedsTotal = !isBuy && quantityNum > totalNum
  const rawOnlyWarn =
    !isBuy && erc20Total === 0n && committed === 0n && rawNum > 0

  const isDisabled =
    quantityNum <= 0 ||
    priceFieldNum <= 0 ||
    priceOverOne ||
    priceNegative ||
    isPending ||
    sellExceedsTotal ||
    insufficientTab

  const displayTotal =
    quantityNum > 0 && priceFieldNum > 0 ? quantityNum * priceFieldNum : 0

  // ── Handler ───────────────────────────────────────────────────────────────────
  async function handlePlaceOffer() {
    if (quantityNum <= 0 || priceFieldNum <= 0) return
    try {
      await placeOrder({
        market,
        outcomeId: slotCtx.selectedId,
        side,
        quantityWei: parseEther(quantityNum.toFixed(6)),
        priceWei: parseEther(priceFieldNum.toFixed(6)),
      })
      setQuantity("")
      setPrice("")
      setTotal("")
    } catch {
      /* toast handled */
    }
  }

  function actionLabel(): string {
    if (isPending) return "Posting…"
    if (quantityNum <= 0 || priceFieldNum <= 0) return "Enter price and amount"
    if (!isBuy) {
      if (sellExceedsTotal) return "Insufficient token balance"
      return `Offer ${fmtAmt(quantityNum)} ${label} at ${fmtAmt(priceFieldNum, 3)} TAB`
    }
    if (insufficientTab) return "Insufficient TAB balance"
    return `Bid ${fmtAmt(quantityNum)} ${label} at ${fmtAmt(priceFieldNum, 3)} TAB`
  }

  const committedNum = parseFloat(formatEther(committed))

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {/* Price stepper */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
            Limit price / token
          </span>
          {bestMarketPrice !== null && (
            <button
              onClick={() => handlePriceChange(bestMarketPrice.toFixed(3))}
              className="font-mono text-[9px] text-muted-foreground/40 tabular-nums transition-colors hover:text-muted-foreground"
              title="Use current market price"
            >
              market: {bestMarketPrice.toFixed(3)}
            </button>
          )}
        </div>
        <div className="flex">
          <button
            onClick={() => adjustPrice(-0.01)}
            aria-label="Decrease price by 0.01"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center",
              "border border-r-0 border-input text-muted-foreground",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "transition-colors duration-100 active:scale-[0.94]"
            )}
          >
            <Minus className="size-3" />
          </button>
          <div className="relative flex-1">
            <Input
              type="number"
              value={price}
              onChange={(e) => handlePriceChange(e.target.value)}
              placeholder="0.500"
              min="0"
              max="1"
              step="0.01"
              className={cn(
                "h-9 rounded-none pr-12 text-center font-mono tabular-nums",
                priceOverOne &&
                  "border-amber-500/50 focus-visible:ring-amber-500/30"
              )}
              disabled={isPending}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
            >
              TAB
            </span>
          </div>
          <button
            onClick={() => adjustPrice(+0.01)}
            aria-label="Increase price by 0.01"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center",
              "border border-l-0 border-input text-muted-foreground",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
              "transition-colors duration-100 active:scale-[0.94]"
            )}
          >
            <Plus className="size-3" />
          </button>
        </div>
        {priceOverOne && (
          <InlineWarn variant="warn">
            Token price must be between 0–1 TAB (token = share of principal)
          </InlineWarn>
        )}
        {priceNegative && (
          <InlineWarn variant="error">Price must be positive</InlineWarn>
        )}
      </div>

      {/* Sell: balance context */}
      {!isBuy && (
        <div className="flex items-center justify-between text-[9px]">
          <span className="tracking-widest text-muted-foreground/40 uppercase">
            Your {label}
          </span>
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span className="text-muted-foreground/50">
              {fmtAmt(freeNum)} free
            </span>
            {committed > 0n && (
              <span className="text-muted-foreground/30">
                · {fmtAmt(committedNum)} in orders
              </span>
            )}
            {rawNum > 0 && (
              <span className="text-muted-foreground/25">
                · {fmtAmt(rawNum)} raw
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tokens + Total */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
              {isBuy ? "Tokens to buy" : "Tokens to sell"}
            </span>
            {!isBuy && freeNum > 0 && (
              <button
                onClick={() => handleQuantityChange(freeNum.toFixed(4))}
                className="text-[9px] font-semibold tracking-wider text-primary/50 uppercase transition-colors duration-100 active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
              >
                MAX
              </button>
            )}
          </div>
          <AmountInput
            value={quantity}
            onChange={handleQuantityChange}
            unit={label.toLowerCase() || "tok"}
            label={`Number of ${label} tokens`}
            disabled={isPending}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
              {isBuy ? "You pay" : "You receive"}
            </span>
            {isBuy && tabBalanceNum > 0 && (
              <span className="font-mono text-[9px] text-muted-foreground/35 tabular-nums">
                {fmtAmt(tabBalanceNum, 2)} TAB
              </span>
            )}
          </div>
          <AmountInput
            value={total}
            onChange={handleTotalChange}
            unit="TAB"
            label="Total TAB amount"
            disabled={isPending}
          />
        </div>
      </div>

      {/* Warnings */}
      {sellExceedsFree && !sellExceedsTotal && (
        <InlineWarn variant="info">
          You only have {fmtAmt(freeNum)} ERC-20 tokens —{" "}
          {fmtAmt(quantityNum - freeNum)} raw tokens will be automatically
          wrapped (requires an extra transaction).
        </InlineWarn>
      )}
      {sellExceedsTotal && (
        <InlineWarn variant="error">
          Insufficient tokens. You have {fmtAmt(totalNum)} {label} in total (
          {fmtAmt(freeNum)} ERC-20 + {fmtAmt(rawNum)} raw).
        </InlineWarn>
      )}
      {insufficientTab && (
        <InlineWarn variant="error">
          Insufficient TAB. You need {fmtAmt(quantityNum * priceFieldNum, 2)}{" "}
          TAB, but you have {fmtAmt(tabBalanceNum, 2)} TAB.
        </InlineWarn>
      )}
      {rawOnlyWarn && (
        <InlineWarn variant="warn">
          Please wrap your raw tokens below before creating an offer.
        </InlineWarn>
      )}

      {/* Receipt */}
      <TxReceipt
        mode="offer"
        isBuy={isBuy}
        outcomeLabel={label}
        outcomeColor={palette.text}
        tokens={quantityNum}
        tabAmount={displayTotal}
        pricePerToken={priceFieldNum}
      />

      <Button
        onClick={handlePlaceOffer}
        disabled={isDisabled}
        className="w-full transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
      >
        {actionLabel()}
      </Button>
    </div>
  )
}
