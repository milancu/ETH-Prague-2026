import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { ConnectButton } from "@/features/wallet/components/connect-button.tsx"

const RootLayout = () => (
  <>
    <div className="flex gap-2 p-2 items-center justify-between">
      <Link to="/" className="[&.active]:font-bold">
        Home
      </Link>{" "}
      <ConnectButton />
    </div>
    <hr />
    <Outlet />
    <TanStackRouterDevtools />
  </>
)

export const Route = createRootRoute({ component: RootLayout })
