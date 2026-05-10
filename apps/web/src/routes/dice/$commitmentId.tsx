import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { motion } from "motion/react"
import { MarketsHeaderControls } from "@/features/market/components/markets-header-controls"
import { DiceRevealPanel } from "@/features/dice/components/dice-reveal-panel"

export const Route = createFileRoute("/dice/$commitmentId")({
  component: DiceRevealPage,
})

function DiceRevealPage() {
  const { commitmentId } = Route.useParams()
  const id = Number(commitmentId)

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/dice"
          className="flex w-fit items-center gap-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
          <motion.span
            layoutId="dice-label"
            className="inline-block text-2xl font-semibold tracking-tight"
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          >
            Cosmic Dice
          </motion.span>
        </Link>
        <MarketsHeaderControls />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-2xl">
          {Number.isFinite(id) ? (
            <DiceRevealPanel commitmentId={id} />
          ) : (
            <div className="border border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              Invalid commitment id.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
