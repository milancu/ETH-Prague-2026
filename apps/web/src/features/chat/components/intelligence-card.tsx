import { useState } from "react"
import { motion } from "motion/react"
import { ArrowRight, RotateCw, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@workspace/ui/lib/utils"
import { useChatContext } from "../chat-context"
import { useIntelligencePayment } from "../use-intelligence-payment"
import type { IntelligenceRequest } from "../schema"

const EASE = [0.23, 1, 0.32, 1] as const
const TOAST_ID = "intel-card"

type Phase = "idle" | "paying" | "failed"

interface Props {
  request: IntelligenceRequest
}

const IntelligenceCard = ({ request }: Props) => {
  const { submitToolResult } = useChatContext()
  const { pay, ready } = useIntelligencePayment()
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  async function handlePay() {
    if (!ready) {
      toast.error("Connect a wallet to pay")
      return
    }
    setPhase("paying")
    setError(null)
    toast.loading(`Signing payment for ${request.tool}…`, { id: TOAST_ID })
    try {
      const data = await pay(request)
      toast.success("Payment confirmed", { id: TOAST_ID })
      // Hand off — the chat hook will append the [tool_result ...] message
      // and re-call /v1/chat. The card unmounts when the parent message's
      // intelligenceRequest is cleared.
      submitToolResult(request.tool, data)
    } catch (err) {
      const reason = parseError(err)
      const rejected = /reject|denied|user/i.test(reason)
      setPhase("failed")
      setError(reason)
      if (rejected) toast.dismiss(TOAST_ID)
      else toast.error(reason, { id: TOAST_ID })
    }
  }

  const isPaying = phase === "paying"
  const isFailed = phase === "failed"
  const queryStr = formatArgs(request.args)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay: 0.08 }}
      style={{ transformOrigin: "top left" }}
      className={cn(
        "w-full max-w-md border border-border bg-card text-card-foreground",
        isFailed && "border-destructive/40",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="size-3" strokeWidth={2.5} />
          intel · x402
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          ${request.price_usd.toFixed(2)} USDC
        </span>
      </div>

      {/* Summary */}
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm leading-snug">
          Kowalski needs to fetch external data.
        </p>
      </div>

      {/* Details */}
      <div className="space-y-1 border-b border-border px-3 py-2.5 font-mono text-[11px]">
        <Row label="tool">{request.tool}</Row>
        {queryStr && <Row label="args">{queryStr}</Row>}
        <Row label="cost">${request.price_usd.toFixed(2)} USDC (off-chain)</Row>
      </div>

      {/* CTA */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={handlePay}
          disabled={!ready || isPaying}
          className={cn(
            "group inline-flex flex-1 items-center justify-between gap-2 border px-3 py-2 text-sm font-medium",
            "transition-[transform,colors] duration-150 ease-out",
            "active:scale-[0.97]",
            isFailed
              ? "border-destructive bg-background text-destructive hover:bg-destructive/5"
              : "border-foreground bg-foreground text-background hover:bg-foreground/90",
            "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
          )}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
            {isPaying ? "Signing…" : isFailed ? "Retry" : "Pay & Continue"}
          </span>
          {isFailed ? (
            <RotateCw className="size-3.5" strokeWidth={2.5} />
          ) : (
            <ArrowRight
              className="size-3.5 transition-transform duration-150 ease-out group-enabled:group-hover:translate-x-0.5"
              strokeWidth={2.5}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={isPaying}
          aria-label="Cancel"
          className={cn(
            "inline-flex size-9 items-center justify-center border border-border text-muted-foreground",
            "transition-[transform,border-color,color] duration-150 ease-out",
            "hover:border-foreground hover:text-foreground active:scale-[0.94]",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          )}
        >
          <X className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {isFailed && error && (
        <p className="border-t border-border px-3 py-1.5 text-[10px] text-destructive">
          {error}
        </p>
      )}
      {!ready && (
        <p className="border-t border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          connect wallet to pay
        </p>
      )}
    </motion.div>
  )
}

interface RowProps {
  label: string
  children: React.ReactNode
}

const Row = ({ label, children }: RowProps) => (
  <div className="flex items-baseline gap-2">
    <span className="w-12 shrink-0 uppercase tracking-[0.12em] text-[10px] text-muted-foreground/70">
      {label}
    </span>
    <span className="min-w-0 flex-1 break-words text-[11px]">{children}</span>
  </div>
)

function formatArgs(args: Record<string, unknown>): string {
  // Surface query if present — that's the human-readable bit. Otherwise show
  // a compact JSON of all args.
  if (typeof args.query === "string" && args.query.length > 0) {
    const max = Number(args.max_items ?? 0)
    return max > 0 ? `"${args.query}" · ${max} items` : `"${args.query}"`
  }
  try {
    return JSON.stringify(args)
  } catch {
    return ""
  }
}

function parseError(err: unknown): string {
  if (!(err instanceof Error)) return "Payment failed"
  const first = err.message.split("\n")[0].trim()
  return first.length > 140 ? first.slice(0, 140) + "…" : first
}

export default IntelligenceCard
