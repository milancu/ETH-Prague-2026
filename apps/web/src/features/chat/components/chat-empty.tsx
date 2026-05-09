import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"

const EASE = [0.23, 1, 0.32, 1] as const

const STARTERS = [
  { label: "Kolik mám TAB?", prompt: "Kolik mám TAB?" },
  { label: "Najdi nejlikvidnější market", prompt: "Najdi mi nejlikvidnější otevřený market." },
  { label: "Co se sází na ETH?", prompt: "Jaké jsou aktuální markety o ETH?" },
  { label: "Vytvoř market o volbách 2026", prompt: "Pomoz mi vytvořit market o českých prezidentských volbách 2026." },
] as const

interface Props {
  onPick: (prompt: string) => void
}

const ChatEmpty = ({ onPick }: Props) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, ease: EASE }}
    className="flex flex-col items-center gap-8 text-center"
  >
    <div className="flex flex-col items-center gap-2">
      <h1 className="font-mono text-xs uppercase tracking-[0.32em] text-muted-foreground">
        Kowalski
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Tvůj asistent pro predikční trhy. Najde, sestaví, zkontroluje
        — podepisuješ ty.
      </p>
    </div>

    <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
      {STARTERS.map((s, i) => (
        <Starter key={s.label} index={i} label={s.label} onPick={() => onPick(s.prompt)} />
      ))}
    </div>
  </motion.div>
)

interface StarterProps {
  index: number
  label: string
  onPick: () => void
}

const Starter = ({ index, label, onPick }: StarterProps) => (
  <motion.button
    type="button"
    onClick={onPick}
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.2, ease: EASE, delay: 0.1 + index * 0.05 }}
    className={cn(
      "group flex items-center justify-between gap-2 border border-border bg-background px-3 py-2.5 text-left text-sm",
      "transition-[transform,border-color,background-color] duration-150 ease-out",
      "hover:border-foreground/40 hover:bg-muted/40",
      "active:scale-[0.98]",
    )}
  >
    <span className="text-foreground">{label}</span>
    <span
      aria-hidden
      className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 transition-colors duration-150 group-hover:text-foreground/60"
    >
      ↵
    </span>
  </motion.button>
)

export default ChatEmpty