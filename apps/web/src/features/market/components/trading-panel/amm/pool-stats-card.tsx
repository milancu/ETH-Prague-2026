import { formatEther } from "viem"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { fmtAmt, slotPalette } from "../shared"
import type { PoolData, UserPoolData } from "./use-amm-pool"
import { outcomeLabels } from "./outcome-labels"

interface Props {
  market: Market
  pool: PoolData
  user: UserPoolData
  totalReserveTab: bigint
}

export function PoolStatsCard({ market, pool, user, totalReserveTab }: Props) {
  const labels = outcomeLabels(market)
  const sharePct =
    user.totalShares > 0n
      ? (Number((user.shares * 10_000n) / user.totalShares) / 100).toFixed(2)
      : "0"

  return (
    <div className="flex flex-col border border-border/60">
      {/* Reserves per outcome */}
      <div className="flex flex-col">
        <div className="border-b border-border/40 px-3 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Reserves
          </span>
        </div>
        {pool.reserves.map((r, i) => {
          const palette = slotPalette(i, market)
          return (
            <div
              key={i}
              className="flex items-center justify-between border-b border-border/30 px-3 py-1.5 last:border-0"
            >
              <div className="flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", palette.dot)} aria-hidden />
                <span className={cn("text-[10px] font-bold uppercase tracking-widest", palette.text)}>
                  {labels[i] ?? `#${i}`}
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {fmtAmt(parseFloat(formatEther(r)))}
              </span>
            </div>
          )
        })}
      </div>

      {/* Pool meta */}
      <div className="grid grid-cols-2 border-t-2 border-border/40">
        <Cell label="Pool value" value={`${fmtAmt(parseFloat(formatEther(totalReserveTab)), 2)} TAB`} />
        <Cell label="Trading fee" value={`${(pool.feeBps / 100).toFixed(2)} %`} />
        <Cell
          label="Your LP shares"
          value={
            user.totalShares > 0n
              ? `${fmtAmt(parseFloat(formatEther(user.shares)), 2)} / ${fmtAmt(parseFloat(formatEther(user.totalShares)), 2)} (${sharePct}%)`
              : "—"
          }
        />
        <Cell
          label="Unclaimed fees"
          value={`${fmtAmt(parseFloat(formatEther(user.pendingFees)), 4)} TAB`}
          highlight={user.pendingFees > 0n}
        />
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-b border-border/30 px-3 py-2 last:border-r-0 odd:border-r [&:nth-child(2n)]:border-r-0">
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          highlight ? "text-emerald-400 font-semibold" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}
