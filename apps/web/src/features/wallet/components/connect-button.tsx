import {
  useAppKit,
  useAppKitAccount,
  useWalletInfo,
} from "@reown/appkit/react"
import { Button } from "@workspace/ui/components/button"

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function ConnectButton() {
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const { walletInfo } = useWalletInfo()

  if (isConnected && address) {
    return (
      <Button
        variant="outline"
        onClick={() => open({ view: "Account" })}
        className="gap-2"
      >
        {walletInfo?.icon && (
          <img
            src={walletInfo.icon}
            alt={walletInfo.name ?? "Wallet"}
            className="h-4 w-4 rounded-sm"
          />
        )}
        {shortenAddress(address)}
      </Button>
    )
  }

  return (
    <Button onClick={() => open({ view: "Connect" })}>Connect Wallet</Button>
  )
}