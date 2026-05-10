import { useState } from "react"
import { formatEther } from "viem"
import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { fmtAmt, slotPalette } from "../shared"
import { useAmmActions } from "./use-amm-actions"
import type { PoolData, UserPoolData } from "./use-amm-pool"
import { outcomeLabels } from "./outcome-labels"

interface Props {
  market: Market
  marketId: number
  pool: PoolData
  user: UserPoolData
}

export function RemoveLiquidityForm({ market, marketId, pool, user }: Props) {
  const [pct, setPct] = useState(50)
  const { removeFunding, isPending } = useAmmActions(marketId)

  const labels = outcomeLabels(market)
  const hasShares = user.shares > 0n

  // sharesIn = userShares * pct / 100, computed at bigint precision
  const sharesIn = hasShares
    ? (user.shares * BigInt(Math.round(pct * 100))) / 10_000n
    : 0n

  // Estimated returns (off-chain mirror of removeFunding math):
  //   outcomeOut[i] = reserves[i] * sharesIn / totalShares
  //   feeOut       = feeAccumulated * sharesIn / totalShares
  const estOutcomeOut = pool.reserves.map((r) =>
    pool.totalShares === 0n ? 0n : (r * sharesIn) / pool.totalShares,
  )
  const estFeeOut =
    pool.totalShares === 0n ? 0n : (pool.feeAccumulated * sharesIn) / pool.totalShares

  const disabled = isPending || sharesIn === 0n

  async function handleSubmit() {
    if (disabled) return
    try {
      await removeFunding(sharesIn, pool.outcomeSlotCount)
    } catch {
      /* toast handled */
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">
          Remove liquidity
        </span>
        <span className="font-mono text-[9px] tabular-nums text-muted-foreground/50">
          {hasShares
            ? `${fmtAmt(parseFloat(formatEther(user.shares)), 2)} shares`
            : "no shares"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="uppercase tracking-widest text-muted-foreground/60">Amount</span>
          <span className="font-mono font-bold tabular-nums text-foreground">{pct}%</span>
        </div>
        <Slider
          value={[pct]}
          onValueChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v
            if (typeof next === "number") setPct(next)
          }}
          min={0}
          max={100}
          step={1}
          disabled={!hasShares || isPending}
        />
        <div className="flex items-center justify-between gap-1">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              disabled={!hasShares || isPending}
              onClick={() => setPct(p)}
              className={cn(
                "flex-1 border border-border/40 py-0.5 text-[9px] font-semibold tabular-nums",
                pct === p
                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                  : "text-muted-foreground/55 hover:text-foreground hover:border-border",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              {p}%
            </button>
          ))}
        </div>
      </div>

      {/* Estimated returns */}
      {hasShares && sharesIn > 0n && (
        <div className="flex flex-col border border-border/40 bg-muted/10">
          <div className="border-b border-border/30 px-2.5 py-1">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
              You receive
            </span>
          </div>
          {estOutcomeOut.map((amt, i) => {
            const palette = slotPalette(i, market)
            return (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border/20 px-2.5 py-1 last:border-0"
              >
                <span className={cn("text-[10px] font-bold uppercase tracking-widest", palette.text)}>
                  {labels[i] ?? `#${i}`}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-foreground">
                  {fmtAmt(parseFloat(formatEther(amt)))}
                </span>
              </div>
            )
          })}
          <div className="flex items-center justify-between border-t border-border/30 bg-muted/20 px-2.5 py-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              + Fees
            </span>
            <span className="font-mono text-[11px] tabular-nums text-emerald-400">
              {fmtAmt(parseFloat(formatEther(estFeeOut)), 4)} TAB
            </span>
          </div>
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={disabled}
        className={cn(
          "h-10 w-full text-xs font-bold uppercase tracking-wider",
          "bg-orange-500/90 text-white hover:bg-orange-500 disabled:bg-orange-500/30",
          "transition-[transform,background-color] duration-150 active:scale-[0.98]",
        )}
      >
        {isPending
          ? "Submitting…"
          : !hasShares
            ? "No shares to withdraw"
            : pct === 0
              ? "Pick an amount"
              : `Withdraw ${pct}%`}
      </Button>
    </div>
  )
}
