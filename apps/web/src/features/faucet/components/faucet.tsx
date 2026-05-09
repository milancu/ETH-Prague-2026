import { useAccount } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import { useWalletBalances } from "@/features/positions/hooks/use-wallet-balances"
import { formatBalance } from "@/features/positions/lib/utils"
import { useMintTab } from "@/features/faucet/hooks/use-mint-tab"

function BalanceRow({ label, value, unit }: { label: string; value: bigint; unit: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border py-3 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular-nums text-sm font-semibold text-foreground">
        {formatBalance(value, 6)}&nbsp;
        <span className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground">{unit}</span>
      </span>
    </div>
  )
}

export function Faucet() {
  const { address, isConnected } = useAccount()
  const { eth, tab } = useWalletBalances(address)
  const { amount, setAmount, quickAmounts, canMint, isPending, simError, mint } = useMintTab()

  if (!isConnected) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Connect your wallet to use the faucet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm">
      {/* Current balances */}
      <div className="border border-border px-3">
        <BalanceRow label="Gas" value={eth} unit="ETH" />
        <BalanceRow label="TABcoin" value={tab} unit="TAB" />
      </div>

      {/* Mint form */}
      <div className="flex flex-col gap-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Amount to mint</p>

        {/* Quick-select buttons */}
        <div className="flex gap-2">
          {quickAmounts.map(q => (
            <button
              key={q}
              onClick={() => setAmount(q)}
              className={cn(
                "flex-1 border py-1.5 text-xs tabular-nums transition-colors",
                amount === q
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground",
              )}
            >
              {Number(q).toLocaleString()}
            </button>
          ))}
        </div>

        {/* Custom amount input */}
        <div className="relative">
          <Input
            type="number"
            min="1"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Custom amount…"
            className="pr-12"
            disabled={isPending}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            TAB
          </span>
        </div>

        {/* Simulation error hint */}
        {simError && (
          <p className="text-xs text-destructive">
            {simError.message.split("\n")[0]}
          </p>
        )}

        <Button
          onClick={mint}
          disabled={!canMint}
          className="w-full"
        >
          {isPending ? "Minting…" : `Mint ${Number(amount || 0).toLocaleString()} TAB`}
        </Button>
      </div>
    </div>
  )
}