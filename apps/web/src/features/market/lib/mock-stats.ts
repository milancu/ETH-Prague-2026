import type { Market } from "@/features/market/types"

// ── Tiny seeded RNG (shared idiom) ────────────────────────────────────────────

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

// ── Per-market deterministic activity stats ──────────────────────────────────

export interface MarketStats {
  /** Total volume in TAB. */
  volumeTab: number
  /** Number of unique traders. */
  traders: number
  /** Number of comments. */
  comments: number
  /** 24h volume change as a percentage (-100..+100). */
  delta24h: number
  /** Number of unread comment replies (rare; for badges). */
  unread: number
}

/**
 * Deterministic mock activity per market — seeded from id, so the numbers
 * never change between renders. Replace with real WS/API data later.
 */
export function getMarketStats(m: Market): MarketStats {
  const rng = lcg(hashStr(`${m.id}::stats`))
  // Skewed distribution: most markets small, a few big.
  const skew = Math.pow(rng(), 2.4)
  const volumeTab = Math.round(200 + skew * 240_000)
  const traders = Math.round(8 + Math.pow(rng(), 1.5) * 1200)
  const comments = Math.round(rng() * 90)
  const delta24h = Math.round((rng() - 0.45) * 60 * 10) / 10 // -27..+33 typical
  const unread = rng() < 0.12 ? Math.ceil(rng() * 5) : 0
  return { volumeTab, traders, comments, delta24h, unread }
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatTabShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return n.toString()
}

export function formatRelativeTime(date: Date, now = Date.now()): string {
  const ms = date.getTime() - now
  const abs = Math.abs(ms)
  const past = ms < 0
  const m = Math.round(abs / 60_000)
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`
  const d = Math.round(h / 24)
  if (d < 14) return past ? `${d}d ago` : `in ${d}d`
  const w = Math.round(d / 7)
  return past ? `${w}w ago` : `in ${w}w`
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

export type SortKey = "trending" | "volume" | "closing" | "newest"

export function sortMarkets(markets: Market[], key: SortKey): Market[] {
  const arr = [...markets]
  switch (key) {
    case "trending":
      // Trending = high volume × big positive 24h delta. Approximation.
      return arr.sort((a, b) => {
        const sa = getMarketStats(a)
        const sb = getMarketStats(b)
        return sb.volumeTab * (1 + sb.delta24h / 100) - sa.volumeTab * (1 + sa.delta24h / 100)
      })
    case "volume":
      return arr.sort((a, b) => getMarketStats(b).volumeTab - getMarketStats(a).volumeTab)
    case "closing":
      return arr.sort((a, b) => a.closingDate.getTime() - b.closingDate.getTime())
    case "newest":
      return arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
}
