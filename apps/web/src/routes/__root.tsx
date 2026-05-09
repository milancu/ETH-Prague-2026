import { useState } from "react"
import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { ConnectButton } from "@/features/wallet/components/connect-button.tsx"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/utils/api-client.ts"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { Toaster } from "sonner"
import { useTheme } from "@/components/theme-provider"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { Menu, X } from "lucide-react"

const NAV_LINKS = [
  { to: "/", label: "Markets" },
  { to: "/orders", label: "Orders" },
  { to: "/positions", label: "Positions" },
  { to: "/faucet", label: "Faucet" },
] as const

const NAV_LINK_CLASS =
  "text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:font-semibold [&.active]:text-foreground"

const RootLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false)

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

  return (
    <>
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
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="relative z-50 shrink-0 border-b border-border">
          <div className="container mx-auto flex items-center justify-between px-4 py-3">
            {/* Desktop nav */}
            <nav className="hidden items-center gap-6 sm:flex">
              {NAV_LINKS.map(({ to, label }) => (
                <Link key={to} to={to} className={NAV_LINK_CLASS}>
                  {label}
                </Link>
              ))}
            </nav>

            {/* Mobile hamburger */}
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
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
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

            <ConnectButton />
          </div>

          {/* Mobile nav panel — absolutely positioned so it overlays content, not pushes it */}
          <AnimatePresence>
            {mobileOpen && (
              <motion.nav
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
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

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex min-h-full flex-col">
            <main className="container mx-auto flex-1 p-4">
              <LayoutGroup>
                <Outlet />
              </LayoutGroup>
            </main>

            <footer className="border-t border-border">
              <div className="container mx-auto p-4">
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
              </div>
            </footer>
          </div>
        </ScrollArea>
      </div>
    </>
  )
}

export const Route = createRootRoute({ component: RootLayout })
