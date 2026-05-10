import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

const FACES: LucideIcon[] = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6]

interface Props {
  /** Final face (1-6). */
  result: number
  /** Pixel size of the dice. */
  size?: number
  className?: string
  /** Fired once the tumble has settled on the final face. */
  onSettle?: () => void
}

const TUMBLE_STEP_MS = 70
const TUMBLE_STEPS = 9 // ~630ms of rolling before the settle spring

/**
 * Tumbles through dice faces, then settles on `result`. The tumble is purely
 * decorative — when the user prefers reduced motion we skip straight to the
 * final face with a soft fade.
 */
export function DiceTumble({ result, size = 168, className, onSettle }: Props) {
  const reduce = useReducedMotion()
  const [step, setStep] = useState(reduce ? TUMBLE_STEPS : 0)
  const isSettled = step >= TUMBLE_STEPS
  const faceIndex = isSettled ? Math.max(0, Math.min(5, result - 1)) : step % 6
  const Face = FACES[faceIndex]

  useEffect(() => {
    if (reduce) {
      onSettle?.()
      return
    }
    if (step >= TUMBLE_STEPS) {
      onSettle?.()
      return
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), TUMBLE_STEP_MS)
    return () => window.clearTimeout(id)
  }, [step, reduce, onSettle])

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Soft glow underneath — intensifies at the settle moment */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, oklch(0.75 0.18 295 / 0.45), transparent 70%)",
          filter: "blur(12px)",
        }}
        initial={{ opacity: 0.3, scale: 0.8 }}
        animate={{
          opacity: isSettled ? 0.75 : 0.45,
          scale: isSettled ? 1.15 : 0.9,
        }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      />

      <motion.div
        // Tumble: rotate and scale on the wrapper. Pivot slightly low so the
        // rotation reads as a weighted die rather than a spinning sticker.
        style={{ transformOrigin: "50% 60%" }}
        initial={reduce ? { scale: 0.95, opacity: 0 } : { scale: 0.6, opacity: 0, rotate: -90 }}
        animate={
          reduce
            ? { scale: 1, opacity: 1 }
            : isSettled
              ? { scale: 1, opacity: 1, rotate: 0 }
              : { scale: 0.92, opacity: 1, rotate: [-90, -45, 0, 30, -10, 0] }
        }
        transition={
          reduce
            ? { duration: 0.25, ease: "easeOut" }
            : isSettled
              ? { type: "spring", duration: 0.5, bounce: 0.3 }
              : { duration: TUMBLE_STEPS * (TUMBLE_STEP_MS / 1000), ease: "linear" }
        }
        className="relative"
      >
        <Face
          aria-label={isSettled ? `Die showed ${result}` : undefined}
          aria-hidden={!isSettled}
          style={{
            width: size,
            height: size,
            // Blur during tumble masks the snap between faces (Emil's trick
            // for hiding imperfect crossfades).
            filter: isSettled || reduce ? "none" : "blur(1.2px)",
            transition: "filter 220ms ease-out",
          }}
          strokeWidth={1.25}
        />
      </motion.div>
    </div>
  )
}
