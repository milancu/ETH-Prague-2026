import { useMemo, useState } from "react"
import { parseEther } from "viem"
import { Info } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useOrders } from "@/features/orders/hooks/use-orders"
import { useFillOrder } from "@/features/orders/hooks/use-fill-order"
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

export function TradeNowPanel({ market, side, slotCtx, tabBalanceNum }: Props) {
  const isBuy = side === "buy"
  const { label, wrapper, palette, freeNum } = slotCtx

  const [quantity, setQuantity] = useState("")

  const { data: allOrders = [] } = useOrders(
    market.marketId != null ? { marketId: market.marketId } : undefined
  )
  const { fillOrder, isPending } = useFillOrder()

  // ── Best order in book ────────────────────────────────────────────────────────
  const bestOrder = useMemo(() => {
    if (!wrapper) return null
    const wLC = wrapper.toLowerCase()
    if (isBuy) {
      const asks = allOrders.filter(
        (o) =>
          o.makerToken.toLowerCase() === wLC &&
          o.takerToken.toLowerCase() === TAB_LC
      )
      if (!asks.length) return null
      return asks.reduce((best, o) =>
        BigInt(o.takerAmount) * BigInt(best.makerAmount) <
        BigInt(best.takerAmount) * BigInt(o.makerAmount)
          ? o
          : best
      )
    } else {
      const bids = allOrders.filter(
        (o) =>
          o.makerToken.toLowerCase() === TAB_LC &&
          o.takerToken.toLowerCase() === wLC
      )
      if (!bids.length) return null
      return bids.reduce((best, o) =>
        BigInt(o.makerAmount) * BigInt(best.takerAmount) >
        BigInt(best.makerAmount) * BigInt(o.takerAmount)
          ? o
          : best
      )
    }
  }, [allOrders, wrapper, isBuy])

  const bestPrice = useMemo(() => {
    if (!bestOrder) return null
    const ma = Number(bestOrder.makerAmount)
    const ta = Number(bestOrder.takerAmount)
    return isBuy ? ta / ma : ma / ta
  }, [bestOrder, isBuy])

  const bookMaxTokens = bestOrder
    ? isBuy
      ? Number(bestOrder.makerAmount) / 1e18
      : Number(bestOrder.takerAmount) / 1e18
    : 0

  // ── Derived ───────────────────────────────────────────────────────────────────
  const quantityNum = parseFloat(quantity) || 0
  const cappedTokens = isBuy
    ? Math.min(quantityNum, bookMaxTokens)
    : Math.min(quantityNum, Math.min(freeNum, bookMaxTokens))
  const displayTotal =
    cappedTokens > 0 && bestPrice ? cappedTokens * bestPrice : 0

  // ── Validation ────────────────────────────────────────────────────────────────
  const insufficientTab =
    isBuy && quantityNum > 0 && displayTotal > tabBalanceNum
  const insufficientFree = !isBuy && quantityNum > freeNum

  const isDisabled =
    !bestOrder ||
    quantityNum <= 0 ||
    isPending ||
    (isBuy && insufficientTab) ||
    (!isBuy && quantityNum > freeNum)

  // ── Handler ───────────────────────────────────────────────────────────────────
  async function handleTrade() {
    if (!bestOrder || quantityNum <= 0) return
    try {
      let fillMakerAmount: bigint
      if (isBuy) {
        fillMakerAmount = parseEther(
          Math.min(quantityNum, bookMaxTokens).toFixed(6)
        )
      } else {
        const cappedSell = Math.min(
          quantityNum,
          Math.min(freeNum, bookMaxTokens)
        )
        const tokensWei = parseEther(cappedSell.toFixed(6))
        fillMakerAmount =
          (BigInt(bestOrder.makerAmount) * tokensWei) /
          BigInt(bestOrder.takerAmount)
      }
      await fillOrder(bestOrder, fillMakerAmount)
      setQuantity("")
    } catch {
      /* toast handled */
    }
  }

  function actionLabel(): string {
    if (isPending) return "Executing…"
    if (!bestOrder)
      return isBuy ? "No sell offers in book" : "No buy offers in book"
    if (cappedTokens <= 0) return "Enter amount"
    if (insufficientTab) return "Insufficient TAB balance"
    return `${isBuy ? "Buy" : "Sell"} ${fmtAmt(cappedTokens)} ${label} · Pay ${fmtAmt(displayTotal, 2)} TAB`
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      {/* Book info or no-book message */}
      {bestOrder ? (
        <div className="flex items-center justify-between border border-border/30 bg-muted/10 px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] tracking-widest text-muted-foreground/40 uppercase">
              {isBuy ? "Best ask" : "Best bid"}
            </span>
            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
              {(bestPrice ?? 0).toFixed(3)} TAB / {label}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-[9px] tracking-widest text-muted-foreground/40 uppercase">
              Available
            </span>
            <span className="font-mono text-xs text-muted-foreground/70 tabular-nums">
              {fmtAmt(bookMaxTokens)} {label}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border border-border/30 bg-muted/10 px-3 py-2.5">
          <Info className="size-3 shrink-0 text-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground/50">
            No {isBuy ? "sell" : "buy"} offers in the book for {label}
          </span>
        </div>
      )}

      {bestOrder && (
        <>
          {/* Sell: balance context */}
          {!isBuy && (
            <div className="flex items-center justify-between text-[9px]">
              <span className="tracking-widest text-muted-foreground/40 uppercase">
                Your {label}
              </span>
              <span className="font-mono text-muted-foreground/50 tabular-nums">
                {fmtAmt(freeNum)} free
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                  {isBuy ? "Tokens to buy" : "Tokens to sell"}
                </span>
                {!isBuy && freeNum > 0 && (
                  <button
                    onClick={() =>
                      setQuantity(Math.min(freeNum, bookMaxTokens).toFixed(4))
                    }
                    className="text-[9px] font-semibold tracking-wider text-primary/50 uppercase transition-colors duration-100 active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
                  >
                    MAX
                  </button>
                )}
              </div>
              <AmountInput
                value={quantity}
                onChange={setQuantity}
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
                value=""
                onChange={() => {}}
                unit="TAB"
                label="Total TAB amount"
                disabled
                placeholder={displayTotal > 0 ? displayTotal.toFixed(4) : "0"}
              />
            </div>
          </div>

          {quantityNum > bookMaxTokens && bookMaxTokens > 0 && (
            <InlineWarn variant="info">
              Only {fmtAmt(bookMaxTokens)} {label} available in the order book —
              trade will be capped at this amount.
            </InlineWarn>
          )}
          {insufficientFree && quantityNum > 0 && (
            <InlineWarn variant="warn">
              You only have {fmtAmt(freeNum)} free {label} tokens (tradeable
              ERC-20). Raw tokens can be wrapped in the "Create offer → Wrap"
              tab.
            </InlineWarn>
          )}
          {insufficientTab && (
            <InlineWarn variant="error">
              Insufficient TAB. You need {fmtAmt(displayTotal, 2)} TAB, but you
              have {fmtAmt(tabBalanceNum, 2)} TAB.
            </InlineWarn>
          )}

          <TxReceipt
            mode="trade"
            isBuy={isBuy}
            outcomeLabel={label}
            outcomeColor={palette.text}
            tokens={cappedTokens}
            tabAmount={displayTotal}
            pricePerToken={bestPrice ?? 0}
          />

          <Button
            onClick={handleTrade}
            disabled={isDisabled}
            className="w-full transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            {actionLabel()}
          </Button>
        </>
      )}
    </div>
  )
}
