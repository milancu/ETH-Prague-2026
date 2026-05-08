import { createFileRoute } from "@tanstack/react-router"
import { MarketDetail } from "@/features/market/components/market-detail"

export const Route = createFileRoute("/markets/$marketId")({
  component: MarketDetailPage,
})

function MarketDetailPage() {
  const { marketId } = Route.useParams()
  return <MarketDetail id={marketId} />
}
