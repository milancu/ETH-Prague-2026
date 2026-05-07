import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import {
  type AppKitNetwork,
  arbitrum,
  base,
  mainnet,
  sepolia,
} from "@reown/appkit/networks"
import { createAppKit } from "@reown/appkit/react"

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  arbitrum,
  base,
  sepolia,
]

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
    url: window.location.origin,
    icons: [],
  },
  features: {
    analytics: !import.meta.env.DEV,
  },
})

export const config = wagmiAdapter.wagmiConfig
