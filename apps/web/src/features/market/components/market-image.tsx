import { CloudSun, Landmark, Sparkles, TrendingUp, Trophy } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market, MarketCategory } from "@/features/market/types"
import { CATEGORY_GRADIENT, CATEGORY_ICON_TINT } from "@/features/market/lib/utils"

const CATEGORY_ICON: Record<MarketCategory, LucideIcon> = {
  Finance:  TrendingUp,
  Politics: Landmark,
  Sport:    Trophy,
  Czech:    Sparkles,
  Weather:  CloudSun,
}

interface Props {
  market: Pick<Market, "category">
  className?: string
  /** Visual size of the icon ("hero" for detail banner, "card" for cards, "thumb" for tiny rows). */
  size?: "hero" | "card" | "thumb"
}

const ICON_SIZE: Record<NonNullable<Props["size"]>, string> = {
  hero:  "size-24 sm:size-32",
  card:  "size-12",
  thumb: "size-7",
}

export function MarketImage({ market, className, size = "card" }: Props) {
  const Icon = CATEGORY_ICON[market.category]
  const tint = CATEGORY_ICON_TINT[market.category]
  const gradient = CATEGORY_GRADIENT[market.category]

  return (
    <div className={cn("relative isolate flex items-center justify-center overflow-hidden", gradient, className)}>
      {/* Soft radial highlight — adds depth so the gradient doesn't feel flat */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_60%)]"
      />
      {/* Fine diagonal grid for texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(45deg,white_1px,transparent_1px),linear-gradient(-45deg,white_1px,transparent_1px)] [background-size:14px_14px]"
      />
      <Icon
        aria-hidden
        strokeWidth={1.25}
        className={cn(
          "relative drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]",
          ICON_SIZE[size],
          tint,
        )}
      />
      {/* Inner ring to anchor the visual */}
      <div aria-hidden className="absolute inset-0 ring-1 ring-inset ring-white/[0.06]" />
    </div>
  )
}
