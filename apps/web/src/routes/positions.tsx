import { createFileRoute } from "@tanstack/react-router"
import { MyPositions } from "@/features/positions/components/my-positions"

export const Route = createFileRoute("/positions")({
  component: PositionsPage,
})

function PositionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My Positions</h1>
        <p className="text-sm text-muted-foreground">Outcome tokens held in your wallet.</p>
      </div>
      <MyPositions />
    </div>
  )
}