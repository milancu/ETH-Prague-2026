import { createFileRoute } from "@tanstack/react-router"
import { Faucet } from "@/features/faucet/components/faucet"

export const Route = createFileRoute("/faucet")({
  component: FaucetPage,
})

function FaucetPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Faucet</h1>
        <p className="text-sm text-muted-foreground">
          Mint TABcoin for testing. Only available on local / Sepolia networks.
        </p>
      </div>
      <Faucet />
    </div>
  )
}