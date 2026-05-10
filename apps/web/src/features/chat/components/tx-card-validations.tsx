import { Check, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ValidationCheck } from "../use-tx-card-executor"

interface Props {
  checks: ValidationCheck[]
}

const TxCardValidations = ({ checks }: Props) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em]">
    {checks.map((c) => (
      <Pill key={c.id} check={c} />
    ))}
  </div>
)

interface PillProps {
  check: ValidationCheck
}

const Pill = ({ check }: PillProps) => {
  const failed = typeof check.status === "string"
  const passed = check.status === true
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 transition-colors duration-150",
        passed && "text-emerald-600 dark:text-emerald-400",
        failed && "text-destructive",
        !passed && !failed && "text-muted-foreground/60",
      )}
      title={typeof check.status === "string" ? check.status : undefined}
    >
      {passed ? (
        <Check className="size-2.5" strokeWidth={3} />
      ) : failed ? (
        <X className="size-2.5" strokeWidth={3} />
      ) : (
        <span className="size-1 bg-current" />
      )}
      {check.label}
    </span>
  )
}

export default TxCardValidations