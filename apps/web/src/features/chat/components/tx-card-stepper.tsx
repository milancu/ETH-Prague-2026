import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import type { StepState } from "../use-tx-card-executor"
import type { TxStep } from "../schema"

interface Props {
  steps: TxStep[]
  states: StepState[]
}

const TxCardStepper = ({ steps, states }: Props) => (
  <ol className="flex flex-col gap-1.5">
    {steps.map((step, i) => (
      <Row
        key={i}
        index={i + 1}
        summary={step.summary}
        state={states[i] ?? { status: "pending" }}
      />
    ))}
  </ol>
)

interface RowProps {
  index: number
  summary: string
  state: StepState
}

const Row = ({ index, summary, state }: RowProps) => {
  const { status, txHash, error } = state
  return (
    <li className="flex items-start gap-2.5 text-xs">
      <Indicator status={status} />
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70",
        )}
      >
        {index.toString().padStart(2, "0")}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "leading-snug",
            status === "done" && "text-muted-foreground line-through decoration-muted-foreground/40",
            status === "failed" && "text-destructive",
          )}
        >
          {summary}
        </span>
        {txHash && (
          <span className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
            {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </span>
        )}
        {error && status === "failed" && (
          <span className="mt-0.5 text-[10px] text-destructive">{error}</span>
        )}
      </div>
    </li>
  )
}

interface IndicatorProps {
  status: StepState["status"]
}

const Indicator = ({ status }: IndicatorProps) => {
  if (status === "active") {
    return (
      <motion.span
        aria-hidden
        initial={{ scale: 0.95, opacity: 0.5 }}
        animate={{ scale: [0.95, 1.15, 0.95], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        className="mt-1 inline-block size-2 bg-foreground"
      />
    )
  }
  if (status === "done") {
    return <span className="mt-1 inline-block size-2 bg-emerald-600 dark:bg-emerald-400" />
  }
  if (status === "failed") {
    return <span className="mt-1 inline-block size-2 bg-destructive" />
  }
  return <span className="mt-1 inline-block size-2 border border-border" />
}

export default TxCardStepper