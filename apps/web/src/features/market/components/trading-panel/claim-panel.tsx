import { useAccount } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useClaimWinnings } from "@/features/market/hooks/use-claim-winnings"
import { formatBalance } from "@/features/positions/lib/utils"
import type { Market } from "@/features/market/types"
import { usePositionData } from "./use-position-data"
import { slotPalette } from "./shared"

export function ClaimPanel({ market }: { market: Market }) {
  const { address } = useAccount()
  const { slots, rawBalances, erc20Balances, wrappers } = usePositionData(address, market)
  const { claimWinnings, isPending } = useClaimWinnings()

  const claimable = slots
    .map((slot, i) => ({
      ...slot,
      rawBalance:     rawBalances[i],
      wrapperAddress: wrappers[i],
      wrappedBalance: erc20Balances[i],
    }))
    .filter(s => s.rawBalance > 0n || s.wrappedBalance > 0n)

  async function handleClaim() {
    try {
      await claimWinnings(market, claimable.map(s => ({
        indexSet:       s.indexSet,
        wrapperAddress: s.wrapperAddress,
        wrappedBalance: s.wrappedBalance,
      })))
    } catch { /* toast handled */ }
  }

  if (!address)
    return <p className="text-xs text-muted-foreground py-2">Connect wallet to claim winnings.</p>
  if (claimable.length === 0)
    return <p className="text-xs text-muted-foreground py-2">No positions to claim for this market.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        {claimable.map((slot) => {
          const pal = slotPalette(slots.indexOf(slot), market)
          const total = slot.rawBalance + slot.wrappedBalance
          return (
            <div key={slot.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className={cn("text-xs font-bold tracking-wide", pal.text)}>{slot.label}</span>
              <span className="font-mono text-xs tabular-nums text-foreground">{formatBalance(total)}</span>
            </div>
          )
        })}
      </div>
      <Button onClick={handleClaim} disabled={isPending} className="self-start">
        {isPending ? "Claiming…" : "Claim All Winnings"}
      </Button>
    </div>
  )
}