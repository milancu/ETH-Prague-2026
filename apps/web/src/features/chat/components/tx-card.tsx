import { useEffect } from "react"
import { motion } from "motion/react"
import { ArrowRight, RotateCw } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { useTxCardExecutor } from "../use-tx-card-executor"
import type { TxCard as TxCardType } from "../schema"
import TxCardStepper from "./tx-card-stepper"
import TxCardValidations from "./tx-card-validations"

const EASE = [0.23, 1, 0.32, 1] as const

interface Props {
  card: TxCardType
}

const TxCard = ({ card }: Props) => {
  const { state, execute, refresh, canExecute } = useTxCardExecutor(card)
  const allSteps = [...card.requires, card]

  // Re-validate when chain changes; cheaper here than another effect inside the hook.
  useEffect(() => {
    if (state.phase === "validating") refresh()
  }, [refresh, state.phase])

  const isRunning = state.phase === "running"
  const isDone = state.phase === "done"
  const isFailed = state.phase === "failed"

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay: 0.08 }}
      style={{ transformOrigin: "top left" }}
      className={cn(
        "w-full max-w-md border border-border bg-card text-card-foreground",
        isFailed && "border-destructive/40",
        isDone && "border-emerald-600/40 dark:border-emerald-500/40",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          tx · chain {card.chain_id}
        </span>
        {(isRunning || isDone) && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {isDone ? "confirmed" : "signing…"}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm leading-snug">{card.summary}</p>
        {card.notice && (
          <p className="mt-1 text-[11px] text-muted-foreground">{card.notice}</p>
        )}
      </div>

      {/* Stepper */}
      <div className="border-b border-border px-3 py-2.5">
        <TxCardStepper steps={allSteps} states={state.steps} />
      </div>

      {/* Validations */}
      <div className="border-b border-border px-3 py-2">
        <TxCardValidations checks={state.validation} />
      </div>

      {/* CTA */}
      <div className="px-3 py-2.5">
        <Cta
          phase={state.phase}
          canExecute={canExecute}
          onClick={execute}
          error={state.error}
        />
      </div>
    </motion.div>
  )
}

interface CtaProps {
  phase: "validating" | "ready" | "running" | "done" | "failed"
  canExecute: boolean
  onClick: () => void
  error?: string
}

const Cta = ({ phase, canExecute, onClick, error }: CtaProps) => {
  if (phase === "done") {
    return (
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
        ✓ all confirmed
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={!canExecute || phase === "running"}
        className={cn(
          "group inline-flex w-full items-center justify-between gap-2 border px-3 py-2 text-sm font-medium",
          "transition-[transform,colors] duration-150 ease-out",
          "active:scale-[0.97]",
          phase === "failed"
            ? "border-destructive bg-background text-destructive hover:bg-destructive/5"
            : "border-foreground bg-foreground text-background hover:bg-foreground/90",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        )}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
          {phase === "failed" ? "Retry" : phase === "running" ? "Working…" : "Approve & Sign"}
        </span>
        {phase === "failed" ? (
          <RotateCw className="size-3.5" strokeWidth={2.5} />
        ) : (
          <ArrowRight className="size-3.5 transition-transform duration-150 ease-out group-enabled:group-hover:translate-x-0.5" strokeWidth={2.5} />
        )}
      </button>
      {error && phase === "failed" && (
        <p className="text-[10px] text-destructive">{error}</p>
      )}
    </div>
  )
}

export default TxCard