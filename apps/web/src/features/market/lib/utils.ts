import type { MarketCategory, MarketStatus } from "@/features/market/types"

const volumeFormatter = new Intl.NumberFormat("en-US")

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

export function formatVolume(n: number): string {
  return volumeFormatter.format(n)
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date)
}

// Static category gradient — used as the placeholder backdrop for MarketImage.
export const CATEGORY_GRADIENT: Record<MarketCategory, string> = {
  Finance:  "bg-[linear-gradient(135deg,#3b2a0a_0%,#7c5a14_50%,#3b2a0a_100%)]",
  Politics: "bg-[linear-gradient(135deg,#0c1e3d_0%,#1e4a8a_50%,#0c1e3d_100%)]",
  Sport:    "bg-[linear-gradient(135deg,#0c2e1d_0%,#1a6a3f_50%,#0c2e1d_100%)]",
  Czech:    "bg-[linear-gradient(135deg,#28104a_0%,#5a26a0_50%,#28104a_100%)]",
  Weather:  "bg-[linear-gradient(135deg,#0a2e3a_0%,#1a7790_50%,#0a2e3a_100%)]",
}

export const CATEGORY_ICON_TINT: Record<MarketCategory, string> = {
  Finance:  "text-amber-200/85",
  Politics: "text-sky-200/85",
  Sport:    "text-emerald-200/85",
  Czech:    "text-violet-200/85",
  Weather:  "text-cyan-100/85",
}

export function marketStatusLabel(status: MarketStatus): string {
  switch (status) {
    case "pending":
    case "open":      return "Active"
    case "resolved":  return "Resolved"
    case "cancelled": return "Cancelled"
  }
}