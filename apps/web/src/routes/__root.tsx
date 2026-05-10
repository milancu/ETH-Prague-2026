import { useEffect, useState } from "react"
import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { ConnectButton } from "@/features/wallet/components/connect-button.tsx"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/utils/api-client.ts"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { Toaster } from "sonner"
import { useTheme } from "@workspace/ui/components/theme-provider"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { Menu, X } from "lucide-react"
import logoUrl from "@/assets/logo.svg"
import { ChatProvider } from "@/features/chat/chat-context"
import ChatPanel from "@/features/chat/components/chat-panel"
import KowalskyMark from "@/features/chat/components/kowalsky-mark"
import { useMediaQuery } from "@/hooks/use-media-query"

const NAV_LINKS = [
  { to: "/", label: "Markets" },
  { to: "https://dice.kowalski-market.com", label: "Dice" },
  { to: "/orders", label: "Orders" },
  { to: "/positions", label: "Positions" },
  { to: "/chat", label: "Chat" },
  { to: "/faucet", label: "Faucet" },
] as const

const NAV_LINK_CLASS =
  "text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:font-semibold [&.active]:text-foreground"

const SIDEBAR_W = 380
const EASE = [0.23, 1, 0.32, 1] as const

const RootLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 640px)")

  const { theme } = useTheme()
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme

  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await apiClient.get<{ status: string }>("/health")
      return res.data
    },
  })

  // Esc closes the chat sidebar.
  useEffect(() => {
    if (!chatOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chatOpen])

  return (
    <ChatProvider>
      <Toaster
        position="bottom-right"
        theme={resolvedTheme}
        toastOptions={{
          style: { borderRadius: 0 },
          classNames: {
            toast:
              "!rounded-none border border-border bg-background text-foreground text-xs",
            title: "!text-xs font-semibold",
            description: "!text-xs text-muted-foreground",
            success: "!border-emerald-500/40",
            error: "!border-destructive/40",
          },
        }}
      />
      <div
        className="flex h-dvh flex-col overflow-hidden"
        style={
          {
            "--header-h": "3.5rem",
            "--footer-h": "3rem",
          } as React.CSSProperties
        }
      >
        <header
          className="relative z-50 shrink-0 border-b border-border"
          style={{ height: "var(--header-h)" }}
        >
          <div className="container mx-auto flex h-full items-center justify-between gap-4 px-4">
            <div className="flex items-center gap-3 sm:gap-6">
              {/* Mobile hamburger — first on mobile, hidden on desktop */}
              <button
                className="-ml-1 p-1 text-muted-foreground transition-colors hover:text-foreground sm:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={mobileOpen ? "x" : "menu"}
                    initial={{ opacity: 0, rotate: -90, scale: 0.7 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.7 }}
                    transition={{ duration: 0.15, ease: EASE }}
                    className="block"
                  >
                    {mobileOpen ? (
                      <X className="size-5" />
                    ) : (
                      <Menu className="size-5" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>

              {/* Logo */}
              <Link to="/" className="flex shrink-0 items-center" aria-label="Home">
                <img src={logoUrl} alt="" className="h-7 w-auto" />
              </Link>

              {/* Desktop nav */}
              <nav className="hidden items-center gap-6 sm:flex">
                {NAV_LINKS.map(({ to, label }) => (
                  <Link key={to} to={to} className={NAV_LINK_CLASS}>
                    {label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <AskKowalskiButton
                open={chatOpen}
                onToggle={() => setChatOpen((v) => !v)}
              />
              <ConnectButton />
            </div>
          </div>

          {/* Mobile nav panel — absolutely positioned so it overlays content, not pushes it */}
          <AnimatePresence>
            {mobileOpen && (
              <motion.nav
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="absolute inset-x-0 top-full border-b border-border bg-background sm:hidden"
              >
                <div className="container mx-auto flex flex-col px-4 py-1">
                  {NAV_LINKS.map(({ to, label }) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        NAV_LINK_CLASS,
                        "border-b border-border py-3 last:border-0"
                      )}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        </header>

        {/* Body row: scrollable main + collapsible chat sidebar.
            min-h-0 lets the ScrollArea actually constrain its child;
            relative anchors the mobile overlay variant of the sidebar. */}
        <div className="relative flex min-h-0 flex-1">
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <div className="flex min-h-full flex-col">
              <main className="container mx-auto flex flex-1 flex-col p-4">
                <LayoutGroup>
                  <Outlet />
                </LayoutGroup>
              </main>

              <footer
                className="shrink-0 border-t border-border"
                style={{ height: "var(--footer-h)" }}
              >
                <div className="container mx-auto flex h-full items-center justify-between gap-4 px-4">
                  <p className="text-xs text-muted-foreground">
                    Backend: {isLoading && <span>checking…</span>}
                    {isError && (
                      <span className="text-destructive">unreachable</span>
                    )}
                    {data && (
                      <span
                        className={cn(
                          data.status === "ok"
                            ? "text-emerald-400"
                            : "text-amber-400"
                        )}
                      >
                        {data.status}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-4">
                    <p className="hidden text-xs text-muted-foreground sm:block">
                      Penguins × Claude
                    </p>
                    <a
                      href="https://api.kowalski-market.com/v1/integrations"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                    >
                      Developers
                    </a>
                  </div>
                </div>
              </footer>
            </div>
          </ScrollArea>

          {/* Desktop: in-flow aside, animates own width so main shrinks. */}
          {isDesktop && (
            <motion.aside
              initial={false}
              animate={{ width: chatOpen ? SIDEBAR_W : 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="hidden shrink-0 overflow-hidden border-l border-border bg-background sm:block"
              aria-hidden={!chatOpen}
            >
              {/* Inner is fixed-width so its layout doesn't reflow during the
                  width animation — it slides into view, doesn't squish. */}
              <div className="h-full" style={{ width: SIDEBAR_W }}>
                <ChatPanel
                  variant="sidebar"
                  onClose={() => setChatOpen(false)}
                />
              </div>
            </motion.aside>
          )}

          {/* Mobile: absolute overlay slide-in from the right with backdrop. */}
          {!isDesktop && (
            <AnimatePresence>
              {chatOpen && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    className="absolute inset-0 z-30 bg-background/60 backdrop-blur-[2px]"
                    onClick={() => setChatOpen(false)}
                    aria-hidden
                  />
                  <motion.aside
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ duration: 0.32, ease: EASE }}
                    className="absolute inset-y-0 right-0 z-40 w-[min(420px,100vw)] border-l border-border bg-background"
                  >
                    <ChatPanel
                      variant="sidebar"
                      onClose={() => setChatOpen(false)}
                    />
                  </motion.aside>
                </>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </ChatProvider>
  )
}

interface AskKowalskiButtonProps {
  open: boolean
  onToggle: () => void
}

const AskKowalskiButton = ({ open, onToggle }: AskKowalskiButtonProps) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-label={open ? "Zavřít Kowalského" : "Zeptej se Kowalského"}
    data-active={open}
    className={cn(
      "group inline-flex items-center gap-2 border border-border bg-background py-1.5 pl-1.5 pr-2.5",
      "transition-[transform,border-color,background-color,color] duration-150 ease-out",
      "hover:border-foreground active:scale-[0.97]",
      "data-[active=true]:border-foreground data-[active=true]:bg-foreground",
    )}
  >
    <KowalskyMark size="sm" className="border-transparent" />
    <span
      className={cn(
        "hidden font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:inline",
        "transition-colors duration-150 group-hover:text-foreground",
        "group-data-[active=true]:text-background",
      )}
    >
      Ask Kowalski
    </span>
  </button>
)

export const Route = createRootRoute({ component: RootLayout })
