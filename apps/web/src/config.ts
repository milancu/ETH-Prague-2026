import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import {
  type AppKitNetwork,
  baseSepolia,
  hardhat,
} from "@reown/appkit/networks"
import { createAppKit } from "@reown/appkit/react"

const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "84532")

// Primary network determined by env — localhost for local dev, Base Sepolia for production.
const primaryNetwork: AppKitNetwork = CHAIN_ID === 31337 ? hardhat : baseSepolia

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [primaryNetwork, baseSepolia, hardhat]

export const projectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "YOUR_PROJECT_ID"

export const wagmiAdapter = new WagmiAdapter({ networks, projectId })

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: "eth-2026",
    description: "eth-2026 dApp",
    url: import.meta.env.VITE_APP_URL ?? window.location.origin,
    icons: [],
  },
  features: {
    analytics: false,
  },
})

export const config = wagmiAdapter.wagmiConfig