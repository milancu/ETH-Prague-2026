import { useState } from "react"
import { parseEther } from "viem"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { AmountInput, InlineWarn } from "../components"
import { fmtAmt } from "../shared"
import { useAmmActions } from "./use-amm-actions"

const MAX_FEE_PCT = 5 // PredictionAMM.MAX_FEE_BPS = 500

interface Props {
  marketId: number
  tabBalanceNum: number
}

export function CreatePoolForm({ marketId, tabBalanceNum }: Props) {
  const [funding, setFunding] = useState("")
  const [feePct, setFeePct] = useState("1")
  const { createPool, isPending } = useAmmActions(marketId)

  const fundingNum = parseFloat(funding) || 0
  const feeNum = parseFloat(feePct)
  const validFee = Number.isFinite(feeNum) && feeNum >= 0 && feeNum <= MAX_FEE_PCT
  const feeBps = validFee ? Math.round(feeNum * 100) : 0
  const insufficientTab = fundingNum > tabBalanceNum
  const disabled =
    isPending || fundingNum <= 0 || !validFee || insufficientTab

  async function handleSubmit() {
    if (disabled) return
    try {
      await createPool(parseEther(fundingNum.toString()), feeBps)
      setFunding("")
    } catch {
      /* toast handled */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 border border-dashed border-border/60 bg-muted/10 px-4 py-5 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          No liquidity pool yet
        </span>
        <p className="text-xs text-muted-foreground/70">
          Be the first to create a pool. Initial funding splits 1∶1 across all outcomes
          (50 / 50 starting prices). You earn the trading fee on every swap.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Initial funding
            </span>
            {tabBalanceNum > 0 && (
              <button
                type="button"
                onClick={() => setFunding(tabBalanceNum.toFixed(4))}
                className="text-[9px] font-semibold tracking-wider uppercase text-primary/50 transition-colors duration-100 active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
              >
                MAX
              </button>
            )}
          </div>
          <AmountInput
            value={funding}
            onChange={setFunding}
            unit="TAB"
            label="Initial pool funding in TAB"
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Trading fee (%)
          </span>
          <AmountInput
            value={feePct}
            onChange={setFeePct}
            unit="%"
            label="Trading fee in percent"
            disabled={isPending}
            placeholder="1"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[9px] tracking-widest text-muted-foreground/40 uppercase">
        <span>Your TAB</span>
        <span className="font-mono tabular-nums text-muted-foreground/60">
          {fmtAmt(tabBalanceNum, 2)} TAB
        </span>
      </div>

      {insufficientTab && (
        <InlineWarn variant="error">
          Insufficient TAB. You need {fmtAmt(fundingNum, 2)} TAB but only have{" "}
          {fmtAmt(tabBalanceNum, 2)} TAB.
        </InlineWarn>
      )}
      {!validFee && feePct.length > 0 && (
        <InlineWarn variant="warn">
          Fee must be between 0 % and {MAX_FEE_PCT} %.
        </InlineWarn>
      )}

      <Button
        onClick={handleSubmit}
        disabled={disabled}
        className={cn(
          "h-11 w-full text-sm font-bold uppercase tracking-wider",
          "bg-emerald-500/90 text-white shadow-[0_8px_24px_-12px] shadow-emerald-500/60",
          "hover:bg-emerald-500 disabled:bg-emerald-500/30 transition-[transform,background-color] duration-150",
          "active:scale-[0.98]",
        )}
      >
        {isPending
          ? "Submitting…"
          : fundingNum <= 0
            ? "Enter amount"
            : `Create pool · ${fmtAmt(fundingNum, 2)} TAB · ${validFee ? feeNum : 0}% fee`}
      </Button>
    </div>
  )
}
