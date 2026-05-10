import { useMemo, useState } from "react"
import { formatEther, parseEther } from "viem"
import { useReadContract } from "wagmi"
import { useAccount } from "wagmi"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import {
  ERC20_ABI,
  PREDICTION_AMM_ABI,
  PREDICTION_AMM_ADDRESS,
} from "@/lib/contracts"
import { fmtAmt, slotPalette } from "../shared"
import { AmountInput, InlineWarn } from "../components"
import { OutcomePillRow } from "./outcome-pill-row"
import { outcomeLabels } from "./outcome-labels"
import { SlippageControl } from "./slippage-control"
import { useAmmActions } from "./use-amm-actions"
import type { PoolData } from "./use-amm-pool"

interface Props {
  market: Market
  marketId: number
  pool: PoolData
}

export function AmmSellCard({ market, marketId, pool }: Props) {
  const { address } = useAccount()
  const [outcome, setOutcome] = useState(0)
  const [amount, setAmount] = useState("")
  const [slippageBps, setSlippageBps] = useState(100)
  const { sell, isPending } = useAmmActions(marketId)

  const labels = outcomeLabels(market)
  const palette = slotPalette(outcome, market)
  const wrapper = pool.wrappers[outcome]

  const num = parseFloat(amount) || 0
  const returnWei = useMemo(() => (num > 0 ? safeParseEther(num) : 0n), [num])

  // Per-outcome wrapper balance for context.
  const { data: wrapperBalance } = useReadContract({
    address: wrapper,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!wrapper, staleTime: 10_000 },
  })
  const wrapperBalNum = parseFloat(formatEther((wrapperBalance ?? 0n) as bigint))

  const { data: quote, error: quoteError } = useReadContract({
    address: PREDICTION_AMM_ADDRESS,
    abi: PREDICTION_AMM_ABI,
    functionName: "calcSellAmount",
    args: returnWei > 0n ? [BigInt(marketId), outcome, returnWei] : undefined,
    query: { enabled: returnWei > 0n, staleTime: 5_000, retry: false },
  })

  const [outcomeIn, feeAmount] = (quote as readonly [bigint, bigint] | undefined) ?? [0n, 0n]
  const outcomeInNum = parseFloat(formatEther(outcomeIn))
  const feeNum = parseFloat(formatEther(feeAmount))
  const pricePerToken = outcomeInNum > 0 ? num / outcomeInNum : 0
  const insufficientWrapper = outcomeIn > (wrapperBalance as bigint | undefined ?? 0n)

  const disabled =
    isPending || returnWei === 0n || outcomeIn === 0n || insufficientWrapper || !!quoteError

  async function handleSell() {
    if (disabled || !wrapper) return
    const maxIn = (outcomeIn * BigInt(10_000 + slippageBps)) / 10_000n
    try {
      await sell(outcome, returnWei, maxIn, wrapper)
      setAmount("")
    } catch {
      /* toast handled */
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400">
          Sell
        </span>
        <SlippageControl value={slippageBps} onChange={setSlippageBps} />
      </div>

      <OutcomePillRow market={market} selected={outcome} onSelect={setOutcome} />

      <AmountInput
        value={amount}
        onChange={setAmount}
        unit="TAB"
        label="TAB to receive"
        disabled={isPending}
      />

      <div className="flex items-center justify-between text-[9px]">
        <span className="uppercase tracking-widest text-muted-foreground/40">
          Your {labels[outcome]}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground/55">
          {fmtAmt(wrapperBalNum)}
        </span>
      </div>

      <div className="flex flex-col border border-border/40 bg-muted/10 px-2.5 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
            You deliver
          </span>
          <span
            className={cn(
              "font-mono text-xs font-bold tabular-nums",
              outcomeInNum > 0 ? palette.text : "text-muted-foreground/30",
            )}
          >
            {outcomeInNum > 0 ? `${fmtAmt(outcomeInNum)} ${labels[outcome]}` : "—"}
          </span>
        </div>
        {outcomeInNum > 0 && (
          <div className="flex items-center justify-between text-[9px] tabular-nums text-muted-foreground/40">
            <span>Price · Fee</span>
            <span className="font-mono">
              {fmtAmt(pricePerToken, 3)} TAB/{labels[outcome]} · {fmtAmt(feeNum, 4)} TAB
            </span>
          </div>
        )}
      </div>

      {insufficientWrapper && outcomeIn > 0n && (
        <InlineWarn variant="error">
          You only have {fmtAmt(wrapperBalNum)} {labels[outcome]} tokens.
        </InlineWarn>
      )}
      {quoteError && returnWei > 0n && (
        <InlineWarn variant="warn">
          Pool can't supply this much TAB. Try a smaller amount.
        </InlineWarn>
      )}

      <Button
        onClick={handleSell}
        disabled={disabled}
        className={cn(
          "h-10 w-full text-xs font-bold uppercase tracking-wider",
          "bg-rose-500/90 text-white hover:bg-rose-500 disabled:bg-rose-500/30",
          "transition-[transform,background-color] duration-150 active:scale-[0.98]",
        )}
      >
        {isPending
          ? "Submitting…"
          : num <= 0
            ? "Enter amount"
            : outcomeIn === 0n
              ? "Quoting…"
              : `Sell for ${fmtAmt(num, 2)} TAB`}
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
