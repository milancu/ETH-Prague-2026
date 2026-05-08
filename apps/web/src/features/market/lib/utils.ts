import type { MarketStatus } from "@/features/market/types"

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

export function marketStatusLabel(status: MarketStatus): string {
  switch (status) {
    case "open":      return "Active"
    case "resolved":  return "Resolved"
    case "cancelled": return "Cancelled"
    case "pending":   return "Pending"
  }
}