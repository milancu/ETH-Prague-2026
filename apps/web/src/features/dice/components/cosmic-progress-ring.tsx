import type { ReactNode } from "react"
import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"

interface Props {
  /** 0 → 1 — fraction of the wait that has elapsed. */
  progress: number
  size?: number
  stroke?: number
  className?: string
  children?: ReactNode
}

/**
 * SVG progress ring with a soft breathing aura. The ring itself rotates slowly
 * so the "energy gathering" feel doesn't depend on the progress value moving
 * (early in the countdown, progress barely budges).
 */
export function CosmicProgressRing({
  progress,
  size = 240,
  stroke = 6,
  className,
  children,
}: Props) {
  const clamped = Math.max(0, Math.min(1, progress))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped)

  return (
    <div
      className={cn(
        "relative grid place-items-center",
        "[--ring-glow:theme(colors.purple.400/40)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* Breathing aura — sits behind the ring */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, var(--ring-glow), transparent 70%)",
          filter: "blur(8px)",
        }}
        animate={{ opacity: [0.35, 0.7, 0.35], scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
      />

      {/* Slowly rotating outer track gives motion even when progress is small */}
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        animate={{ rotate: [-90, 270] }}
        transition={{ duration: 24, ease: "linear", repeat: Infinity }}
      >
        <defs>
          <linearGradient id="cosmic-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.16 305)" />
            <stop offset="50%" stopColor="oklch(0.65 0.22 295)" />
            <stop offset="100%" stopColor="oklch(0.55 0.20 270)" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#cosmic-ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        />
      </motion.svg>

      <div className="relative grid place-items-center">{children}</div>
    </div>
  )
}
