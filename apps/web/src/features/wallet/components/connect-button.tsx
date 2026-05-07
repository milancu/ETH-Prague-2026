import { useAppKit, useAppKitAccount } from "@reown/appkit/react"
import { Button } from "@workspace/ui/components/button"

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function ConnectButton() {
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()

  if (isConnected && address) {
    return (
      <Button variant="outline" onClick={() => open({ view: "Account" })}>
        {shortenAddress(address)}
      </Button>
    )
  }

  return (
    <Button onClick={() => open({ view: "Connect" })}>Connect Wallet</Button>
  )
}