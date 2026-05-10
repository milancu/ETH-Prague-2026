import { ArrowDown, ArrowRight, AlertTriangle } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { formatBalance } from "@/features/positions/lib/utils"
import type { SlotPalette } from "./shared"
import { fmtAmt } from "./shared"

// ── Amount input ──────────────────────────────────────────────────────────────

export function AmountInput({ value, onChange, unit, label, disabled, placeholder }: {
  value: string
  onChange: (v: string) => void
  unit: string
  label: string
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className="relative flex-1">
      <Input
        type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "0"} min="0" aria-label={label}
        className="h-11 pr-14 text-base font-semibold tabular-nums md:text-base"
        disabled={disabled}
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold tracking-widest text-muted-foreground/70 uppercase">
        {unit}
      </span>
    </div>
  )
}

// ── Inline warning ────────────────────────────────────────────────────────────

export function InlineWarn({ variant, children }: {
  variant: "warn" | "error" | "info"
  children: React.ReactNode
}) {
  return (
    <div className={cn(
      "flex items-start gap-1.5 px-2.5 py-1.5 text-[10px] leading-relaxed",
      variant === "error" && "bg-rose-500/8 text-rose-400/80",
      variant === "warn"  && "bg-amber-500/8 text-amber-400/80",
      variant === "info"  && "bg-blue-500/8 text-blue-400/70",
    )}>
      <AlertTriangle className="size-3 mt-px shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ── Transaction receipt ───────────────────────────────────────────────────────

export function TxReceipt({ mode, isBuy, outcomeLabel, outcomeColor, tokens, tabAmount, pricePerToken }: {
  mode: "trade" | "offer"
  isBuy: boolean
  outcomeLabel: string
  outcomeColor: string
  tokens: number
  tabAmount: number
  pricePerToken: number
}) {
  if (tokens <= 0 || tabAmount <= 0) return null

  const sendValue  = isBuy ? `${fmtAmt(tabAmount)} TAB`          : `${fmtAmt(tokens)} ${outcomeLabel}`
  const recvValue  = isBuy ? `${fmtAmt(tokens)} ${outcomeLabel}` : `${fmtAmt(tabAmount)} TAB`
  const recvColor  = isBuy ? outcomeColor : "text-emerald-400"

  return (
    <div className={cn(
      "flex flex-col border border-border/50 bg-muted/10 overflow-hidden",
      "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150",
    )}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">{isBuy ? "You pay" : "You deliver"}</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{sendValue}</span>
      </div>
      <div className="flex items-center gap-2 px-3">
        <div className="h-px flex-1 bg-border/40" />
        <ArrowDown className="size-2.5 text-muted-foreground/30 shrink-0" />
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">You receive</span>
        <span className={cn("font-mono text-xs font-bold tabular-nums", recvColor)}>{recvValue}</span>
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/40 bg-muted/20">
        <span className="text-[9px] text-muted-foreground/35 uppercase tracking-widest">
          {mode === "offer" ? (isBuy ? "Fills when seller asks ≤" : "Fills when buyer bids ≥") : "Price"}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-muted-foreground/50">
          {fmtAmt(pricePerToken, 3)} TAB / {outcomeLabel}
        </span>
      </div>
    </div>
  )
}

// ── Position row ──────────────────────────────────────────────────────────────

export function PositionRow({ label, raw, wrapped, wrapperExists, palette, isWrapping, onWrap }: {
  label: string
  raw: bigint
  wrapped: bigint
  wrapperExists: boolean
  palette: SlotPalette
  isWrapping: boolean
  onWrap: () => void
}) {
  const hasRaw = raw > 0n
  const hasWrapped = wrapped > 0n
  const stepsHint = !wrapperExists ? "3 txs" : "1 tx"

  return (
    <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", palette.dot)} aria-hidden />
        <span className={cn("text-[11px] font-bold tracking-widest", palette.text)}>{label}</span>
      </div>
      <span className={cn("text-right font-mono text-xs tabular-nums", hasRaw ? "text-foreground" : "text-muted-foreground/25")}>
        {hasRaw ? formatBalance(raw) : "—"}
      </span>
      <div className="flex flex-col items-center gap-0.5">
        {hasRaw ? (
          <>
            <button
              onClick={onWrap} disabled={isWrapping}
              aria-label={`Wrap ${label} to ERC-20 (${stepsHint})`}
              className={cn(
                "flex items-center justify-center w-full py-1",
                "text-[10px] font-bold border border-border/60 hover:border-foreground/30",
                "text-muted-foreground/50 hover:text-foreground transition-colors duration-100 active:scale-[0.97]",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              )}
            >
              {isWrapping ? <span className="animate-pulse">…</span> : <ArrowRight className="size-3" aria-hidden />}
            </button>
            <span className="text-[8px] text-muted-foreground/30 tabular-nums">{stepsHint}</span>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/15 text-center w-full">→</span>
        )}
      </div>
      <span className={cn("text-right font-mono text-xs tabular-nums", hasWrapped ? cn("font-semibold", palette.text) : "text-muted-foreground/25")}>
        {hasWrapped ? formatBalance(wrapped) : "—"}
      </span>
    </div>
  )
}