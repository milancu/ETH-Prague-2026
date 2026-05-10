import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRight, Search, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import type { Market } from "@/features/market/types"
import { formatRelativeTime, formatTabShort, getMarketStats } from "@/features/market/lib/mock-stats"

const EASE = [0.23, 1, 0.32, 1] as const

interface Props {
  markets: Market[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

function score(market: Market, q: string): number {
  if (!q) return 0
  const t = market.title.toLowerCase()
  const ql = q.toLowerCase()
  if (t === ql) return 1000
  if (t.startsWith(ql)) return 500
  const idx = t.indexOf(ql)
  if (idx >= 0) return 200 - idx
  // Light fuzzy: each word in q must appear somewhere in title
  const words = ql.split(/\s+/).filter(Boolean)
  if (words.every((w) => t.includes(w))) return 80
  return 0
}

export function MarketCommandPalette({ markets, open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    if (!query.trim()) {
      // Empty query → show top 8 by volume as suggestions
      return [...markets]
        .sort((a, b) => getMarketStats(b).volumeTab - getMarketStats(a).volumeTab)
        .slice(0, 8)
    }
    return markets
      .map((m) => ({ m, s: score(m, query.trim()) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.m)
  }, [markets, query])

  // Reset & focus when opening.
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIdx(0)
      // Defer focus until after the dialog's enter animation starts
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keyboard nav.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIdx((i) => Math.min(results.length - 1, i + 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      } else if (e.key === "Enter") {
        const m = results[activeIdx]
        if (m) {
          e.preventDefault()
          navigate({ to: "/markets/$marketId", params: { marketId: m.id } })
          onOpenChange(false)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, results, activeIdx, navigate, onOpenChange])

  // Keep active item in view.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIdx])

  // Reset active when query changes.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[70vh] w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-label="Search markets"
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search aria-hidden className="size-4 text-muted-foreground/60" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search markets…"
                className="h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Results */}
            <div ref={listRef} className="flex flex-1 flex-col overflow-y-auto py-1">
              {results.length === 0 && (
                <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/50">
                  No markets match "{query}"
                </div>
              )}
              {!query.trim() && results.length > 0 && (
                <div className="px-4 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                  Top by volume
                </div>
              )}
              {results.map((m, i) => {
                const stats = getMarketStats(m)
                const active = i === activeIdx
                return (
                  <button
                    key={m.id}
                    data-idx={i}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => {
                      navigate({ to: "/markets/$marketId", params: { marketId: m.id } })
                      onOpenChange(false)
                    }}
                    className={cn(
                      "group flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100",
                      active ? "bg-accent text-accent-foreground" : "text-foreground/85",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium">{m.title}</span>
                      <span className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <span className="font-semibold uppercase tracking-widest text-muted-foreground/80">
                          {m.category}
                        </span>
                        <span className="tabular-nums">
                          {formatTabShort(stats.volumeTab)} TAB
                        </span>
                        <span className="tabular-nums">
                          · closes {formatRelativeTime(m.closingDate)}
                        </span>
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0 transition-opacity duration-100",
                        active ? "opacity-80" : "opacity-0",
                      )}
                    />
                  </button>
                )
              })}
            </div>

            {/* Footer hints */}
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground/50">
              <div className="flex items-center gap-3">
                <Hint k="↑↓">Navigate</Hint>
                <Hint k="↵">Open</Hint>
                <Hint k="Esc">Close</Hint>
              </div>
              <span className="tabular-nums">{results.length} results</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="border border-border bg-background px-1 py-px font-mono text-[9px] not-italic text-foreground/70">
        {k}
      </kbd>
      <span>{children}</span>
    </span>
  )
}
