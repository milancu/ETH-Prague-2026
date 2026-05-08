import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { ConnectButton } from "@/features/wallet/components/connect-button.tsx"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/utils/api-client.ts"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { Toaster } from "sonner"
import { useTheme } from "@/components/theme-provider"

const NAV_LINKS = [
  { to: "/", label: "Markets" },
  { to: "/orders", label: "Orders" },
  { to: "/positions", label: "Positions" },
] as const

const RootLayout = () => {
  const { theme } = useTheme()
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
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
          toast: "!rounded-none border border-border bg-background text-foreground text-xs",
          title: "!text-xs font-semibold",
          description: "!text-xs text-muted-foreground",
          success: "!border-emerald-500/40",
          error: "!border-destructive/40",
        },
      }}
    />
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-6">
            {NAV_LINKS.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className="text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:font-semibold [&.active]:text-foreground"
              >
                {label}
              </Link>
            ))}
          </nav>
          <ConnectButton />
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col">
          <main className="container mx-auto flex-1 p-4">
            <Outlet />
          </main>

          <footer className="border-t border-border">
          <div className="container mx-auto p-4">
            <p className="text-xs text-muted-foreground">
              Backend:{" "}
              {isLoading && <span>checking…</span>}
              {isError && <span className="text-destructive">unreachable</span>}
              {data && (
                <span className={cn(
                  data.status === "ok" ? "text-emerald-400" : "text-amber-400"
                )}>
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