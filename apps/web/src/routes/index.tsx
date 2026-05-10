import { createFileRoute } from "@tanstack/react-router"
import { MarketList } from "@/features/market/components/market-list"

export const Route = createFileRoute("/")({
  component: MarketList,
})