/**
 * Three dots that fade in sequence. Pure CSS so it's GPU-accelerated and
 * runs off the main thread (Vercel rendering rules + Emil's perf notes).
 */
const ThinkingDots = () => (
  <span className="inline-flex items-center gap-1" aria-label="Kowalski thinks">
    <Dot delay="0ms" />
    <Dot delay="160ms" />
    <Dot delay="320ms" />
    <style>{`
      @keyframes kowalsky-pulse {
        0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
        30%           { opacity: 1;    transform: translateY(-1px); }
      }
    `}</style>
  </span>
)

interface DotProps {
  delay: string
}

const Dot = ({ delay }: DotProps) => (
  <span
    className="size-1 bg-foreground"
    style={{
      animation: "kowalsky-pulse 1.1s ease-in-out infinite",
      animationDelay: delay,
    }}
  />
)

export default ThinkingDots