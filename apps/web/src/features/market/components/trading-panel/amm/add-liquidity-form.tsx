import { useState } from "react"
import { parseEther } from "viem"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { AmountInput, InlineWarn } from "../components"
import { fmtAmt } from "../shared"
import { useAmmActions } from "./use-amm-actions"

interface Props {
  marketId: number
  tabBalanceNum: number
}

export function AddLiquidityForm({ marketId, tabBalanceNum }: Props) {
  const [amount, setAmount] = useState("")
  const { addFunding, isPending } = useAmmActions(marketId)

  const num = parseFloat(amount) || 0
  const insufficient = num > tabBalanceNum
  const disabled = isPending || num <= 0 || insufficient

  async function handleSubmit() {
    if (disabled) return
    try {
      await addFunding(parseEther(num.toString()))
      setAmount("")
    } catch {
      /* toast handled */
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">
          Add liquidity
        </span>
        <span className="font-mono text-[9px] tabular-nums text-muted-foreground/50">
          {fmtAmt(tabBalanceNum, 2)} TAB
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AmountInput
          value={amount}
          onChange={setAmount}
          unit="TAB"
          label="Liquidity to add (TAB)"
          disabled={isPending}
        />
        {tabBalanceNum > 0 && (
          <button
            type="button"
            onClick={() => setAmount(tabBalanceNum.toFixed(4))}
            className="text-[9px] font-semibold tracking-wider uppercase text-primary/50 transition-colors duration-100 active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
          >
            MAX
          </button>
        )}
      </div>
      {insufficient && (
        <InlineWarn variant="error">Insufficient TAB balance.</InlineWarn>
      )}
      <Button
        onClick={handleSubmit}
        disabled={disabled}
        className={cn(
          "h-10 w-full text-xs font-bold uppercase tracking-wider",
          "bg-emerald-500/90 text-white hover:bg-emerald-500 disabled:bg-emerald-500/30",
          "transition-[transform,background-color] duration-150 active:scale-[0.98]",
        )}
      >
        {isPending ? "Submitting…" : num <= 0 ? "Enter amount" : `Add ${fmtAmt(num, 2)} TAB`}
      </Button>
    </div>
  )
}
