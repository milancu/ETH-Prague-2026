import { useMemo } from "react"
import { motion, useReducedMotion } from "motion/react"

interface Props {
  /** Trigger the burst — a key prop ensures remount = re-fire. */
  fireKey?: string | number
  particleCount?: number
}

const COLORS = [
  "oklch(0.78 0.18 305)", // bright violet
  "oklch(0.72 0.18 280)", // indigo
  "oklch(0.85 0.16 95)", // gold
  "oklch(0.78 0.18 150)", // emerald
  "oklch(0.92 0.04 290)", // near-white
]

/**
 * One-shot particle burst for the reveal moment. Particles radiate from the
 * center of the parent (which must be relatively positioned). Skips entirely
 * when prefers-reduced-motion is set.
 */
export function CosmicConfetti({ fireKey = 0, particleCount = 22 }: Props) {
  const reduce = useReducedMotion()

  const particles = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.4
      const distance = 90 + Math.random() * 140
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance
      const size = 4 + Math.random() * 4
      return {
        id: i,
        dx,
        dy,
        size,
        color: COLORS[i % COLORS.length],
        duration: 0.7 + Math.random() * 0.5,
        delay: Math.random() * 0.06,
        rotate: Math.random() * 360,
      }
    })
    // Re-seed when fireKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireKey, particleCount])

  if (reduce) return null

  return (
    <div
      key={fireKey}
      aria-hidden
      className="pointer-events-none absolute inset-0 grid place-items-center overflow-visible"
    >
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute"
          style={{
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: 1,
            boxShadow: `0 0 8px ${p.color}`,
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{
            x: p.dx,
            y: p.dy,
            opacity: 0,
            rotate: p.rotate,
            scale: 0.4,
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: [0.23, 1, 0.32, 1],
          }}
        />
      ))}
    </div>
  )
}
