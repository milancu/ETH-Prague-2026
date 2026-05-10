import { useEffect, useRef, useState, type MutableRefObject } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Loader2, Mic, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { LiveWaveform } from "./live-waveform"
import type { RecorderState } from "@/features/chat/use-voice-recorder"

// Strong ease-out — Emil-style. Built-in `ease-out` lacks the snap.
const EASE_OUT = [0.23, 1, 0.32, 1] as const

interface VoiceOverlayProps {
  open: boolean
  state: RecorderState
  hasSpokenRef: MutableRefObject<boolean>
  levelRef: MutableRefObject<number>
  onCancel: () => void
}

const VoiceOverlay = ({
  open,
  state,
  hasSpokenRef,
  levelRef,
  onCancel,
}: VoiceOverlayProps) => {
  const reduceMotion = useReducedMotion()

  // ESC closes the overlay.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className={cn(
            "fixed inset-0 z-[60] flex items-center justify-center",
            "bg-background/85 backdrop-blur-md",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Hlasové nahrávání"
        >
          <motion.div
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 8 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.97, y: 4 }
            }
            transition={{ duration: 0.26, ease: EASE_OUT }}
            className={cn(
              "relative mx-4 flex w-full max-w-md flex-col items-center gap-7",
              "border border-border bg-background px-6 py-10 sm:px-10 sm:py-12",
              "shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)]",
            )}
          >
            <PulsingMic state={state} levelRef={levelRef} />

            <WaveformBlock state={state} />

            <StatusText state={state} hasSpokenRef={hasSpokenRef} />

            <CancelButton onCancel={onCancel} disabled={state === "processing"} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default VoiceOverlay

/* ----------------------------- subcomponents ---------------------------- */

interface PulsingMicProps {
  state: RecorderState
  levelRef: MutableRefObject<number>
}

const PulsingMic = ({ state, levelRef }: PulsingMicProps) => {
  const ringRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const isRecording = state === "recording"

  // Drive ring scale + opacity from mic RMS via rAF. We avoid React state to
  // keep this off the render path entirely — a 60fps subscription would
  // re-render the tree every frame otherwise.
  useEffect(() => {
    if (!isRecording || reduceMotion) {
      if (ringRef.current) ringRef.current.style.transform = "scale(1)"
      return
    }
    let raf = 0
    const tick = () => {
      const el = ringRef.current
      if (!el) return
      // Soften and clamp; idle floor so the ring still has presence.
      const lvl = Math.min(1, levelRef.current * 4)
      const scale = 1 + lvl * 0.55
      el.style.transform = `scale(${scale.toFixed(3)})`
      el.style.opacity = `${(0.18 + lvl * 0.45).toFixed(3)}`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isRecording, levelRef, reduceMotion])

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay: 0.04 }}
      className="relative flex size-16 items-center justify-center"
    >
      {/* Voice-driven ring. Opacity + transform only — GPU-friendly. */}
      <div
        ref={ringRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full bg-foreground/15",
          "transition-[transform,opacity] duration-100 ease-out",
          "will-change-transform",
        )}
      />
      <div
        className={cn(
          "relative z-10 flex size-12 items-center justify-center rounded-full",
          "border border-border bg-background",
          state === "recording" && "border-foreground text-foreground",
          state === "processing" && "border-border text-muted-foreground",
        )}
      >
        {state === "processing" ? (
          <Loader2 className="size-5 animate-spin" strokeWidth={2.25} />
        ) : (
          <Mic className="size-5" strokeWidth={2.25} />
        )}
      </div>
    </motion.div>
  )
}

const WaveformBlock = ({ state }: { state: RecorderState }) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay: 0.09 }}
      className={cn(
        "flex h-[120px] w-full items-center justify-center border border-border bg-muted/30",
        "overflow-hidden",
      )}
    >
      <LiveWaveform
        active={state === "recording"}
        processing={state === "processing"}
        barWidth={3}
        barGap={2}
        barRadius={2}
        fadeEdges
        fadeWidth={36}
        sensitivity={2.0}
        smoothingTimeConstant={0.82}
        height={96}
        mode="static"
        className="h-full w-full px-4"
      />
    </motion.div>
  )
}

interface StatusTextProps {
  state: RecorderState
  hasSpokenRef: MutableRefObject<boolean>
}

const StatusText = ({ state, hasSpokenRef }: StatusTextProps) => {
  const reduceMotion = useReducedMotion()
  // hasSpoken lives outside React. Mirror it into state on a 150ms poll
  // (only while recording) so a re-render swaps "Mluvte teď" → "Poslouchám"
  // without us touching the ref during render.
  const [hasSpoken, setHasSpoken] = useState(false)
  useEffect(() => {
    if (state !== "recording") return
    const id = window.setInterval(() => {
      setHasSpoken(hasSpokenRef.current)
    }, 150)
    return () => {
      window.clearInterval(id)
      // Reset on unmount/state change so the next recording starts clean.
      setHasSpoken(false)
    }
  }, [state, hasSpokenRef])

  let primary: string
  let secondary: string
  if (state === "processing") {
    primary = "Přepisuji…"
    secondary = "Chvilku to potrvá"
  } else if (state === "recording" && hasSpoken) {
    primary = "Poslouchám"
    secondary = "Až přestaneš mluvit, automaticky to odešlu"
  } else if (state === "recording") {
    primary = "Mluvte teď"
    secondary = "Stačí mluvit, sám vás zastavím"
  } else {
    primary = "Hotovo"
    secondary = ""
  }

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT, delay: 0.14 }}
      className="flex flex-col items-center gap-1 text-center"
      // Live region: assistive tech announces status changes.
      aria-live="polite"
    >
      <span
        key={primary}
        className={cn(
          "font-mono text-xs uppercase tracking-[0.32em] text-foreground",
        )}
      >
        {primary}
      </span>
      {secondary && (
        <span className="text-xs text-muted-foreground">{secondary}</span>
      )}
    </motion.div>
  )
}

const CancelButton = ({
  onCancel,
  disabled,
}: {
  onCancel: () => void
  disabled?: boolean
}) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onCancel}
      disabled={disabled}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT, delay: 0.18 }}
      aria-label="Zrušit nahrávání"
      className={cn(
        "inline-flex items-center gap-2 border border-border bg-background px-3 py-1.5",
        "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
        "transition-[transform,border-color,color] duration-150 ease-out",
        "hover:border-foreground hover:text-foreground active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
      )}
    >
      <X className="size-3" strokeWidth={2.5} />
      Zrušit
    </motion.button>
  )
}

