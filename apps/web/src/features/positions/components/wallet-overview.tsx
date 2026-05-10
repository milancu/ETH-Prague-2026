import { useWalletBalances } from "@/features/positions/hooks/use-wallet-balances"
import { formatBalance } from "@/features/positions/lib/utils"

interface WalletOverviewProps {
  address: `0x${string}`
}

export function WalletOverview({ address }: WalletOverviewProps) {
  const { eth, tab, isLoading } = useWalletBalances(address)

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Gas</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums text-foreground ${isLoading ? "animate-pulse" : ""}`}>
          {isLoading ? "—" : formatBalance(eth, 6)}
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">ETH</p>
      </div>
      <div className="border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Balance</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums text-foreground ${isLoading ? "animate-pulse" : ""}`}>
          {isLoading ? "—" : formatBalance(tab)}
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">TAB</p>
      </div>
    </div>
  )
}