import { useMemo, useState } from "react"
import { formatEther, parseEther } from "viem"
import { useReadContract } from "wagmi"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import {
  PREDICTION_AMM_ABI,
  PREDICTION_AMM_ADDRESS,
} from "@/lib/contracts"
import { fmtAmt, slotPalette } from "../shared"
import { AmountInput, InlineWarn } from "../components"
import { OutcomePillRow } from "./outcome-pill-row"
import { outcomeLabels } from "./outcome-labels"
import { SlippageControl } from "./slippage-control"
import { useAmmActions } from "./use-amm-actions"

interface Props {
  market: Market
  marketId: number
  tabBalanceNum: number
}

export function AmmBuyCard({ market, marketId, tabBalanceNum }: Props) {
  const [outcome, setOutcome] = useState(0)
  const [amount, setAmount] = useState("")
  const [slippageBps, setSlippageBps] = useState(100)
  const { buy, isPending } = useAmmActions(marketId)

  const labels = outcomeLabels(market)
  const palette = slotPalette(outcome, market)

  const num = parseFloat(amount) || 0
  const investWei = useMemo(
    () => (num > 0 ? safeParseEther(num) : 0n),
    [num],
  )

  const { data: quote } = useReadContract({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    functionName: "calcBuyAmount",
    args: investWei > 0n ? [BigInt(marketId), outcome, investWei] : undefined,
    query: { enabled: investWei > 0n, staleTime: 5_000 },
  })

  const [outcomeOut, feeAmount] = (quote as readonly [bigint, bigint] | undefined) ?? [0n, 0n]
  const outcomeOutNum = parseFloat(formatEther(outcomeOut))
  const feeNum = parseFloat(formatEther(feeAmount))
  const pricePerToken = outcomeOutNum > 0 ? num / outcomeOutNum : 0

  const insufficient = num > tabBalanceNum
  const disabled = isPending || investWei === 0n || outcomeOut === 0n || insufficient

  async function handleBuy() {
    if (disabled) return
    const minOut = (outcomeOut * BigInt(10_000 - slippageBps)) / 10_000n
    try {
      await buy(outcome, investWei, minOut)
      setAmount("")
    } catch {
      /* toast handled */
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          Buy
        </span>
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
      </div>

      <OutcomePillRow market={market} selected={outcome} onSelect={setOutcome} />

      <div className="flex items-center gap-2">
        <AmountInput
          value={amount}
          onChange={setAmount}
          unit="TAB"
          label="TAB to spend"
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

      <div className="flex items-center justify-between text-[9px]">
        <span className="uppercase tracking-widest text-muted-foreground/40">Your TAB</span>
        <span className="font-mono tabular-nums text-muted-foreground/55">
          {fmtAmt(tabBalanceNum, 2)}
        </span>
      </div>

      {/* Quote */}
      <div className="flex flex-col border border-border/40 bg-muted/10 px-2.5 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
            You receive
          </span>
          <span
            className={cn(
              "font-mono text-xs font-bold tabular-nums",
              outcomeOutNum > 0 ? palette.text : "text-muted-foreground/30",
            )}
          >
            {outcomeOutNum > 0 ? `${fmtAmt(outcomeOutNum)} ${labels[outcome]}` : "—"}
          </span>
        </div>
        {outcomeOutNum > 0 && (
          <div className="flex items-center justify-between text-[9px] tabular-nums text-muted-foreground/40">
            <span>Price · Fee</span>
            <span className="font-mono">
              {fmtAmt(pricePerToken, 3)} TAB/{labels[outcome]} · {fmtAmt(feeNum, 4)} TAB
            </span>
          </div>
        )}
      </div>

      {insufficient && <InlineWarn variant="error">Insufficient TAB.</InlineWarn>}

      <Button
        onClick={handleBuy}
        disabled={disabled}
        className={cn(
          "h-10 w-full text-xs font-bold uppercase tracking-wider",
          "bg-emerald-500/90 text-white hover:bg-emerald-500 disabled:bg-emerald-500/30",
          "transition-[transform,background-color] duration-150 active:scale-[0.98]",
        )}
      >
        {isPending
          ? "Submitting…"
          : num <= 0
            ? "Enter amount"
            : outcomeOut === 0n
              ? "Quoting…"
              : `Buy ${fmtAmt(outcomeOutNum)} ${labels[outcome]}`}
      </Button>
    </div>
  )
}

function safeParseEther(n: number): bigint {
  try {
    return parseEther(n.toFixed(18).replace(/0+$/, "").replace(/\.$/, ""))
  } catch {
    return 0n
  }
}
