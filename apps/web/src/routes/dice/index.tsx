import { createFileRoute } from "@tanstack/react-router"
import { DiceList } from "@/features/dice/components/dice-list"

export const Route = createFileRoute("/dice/")({
  component: DiceList,
})
