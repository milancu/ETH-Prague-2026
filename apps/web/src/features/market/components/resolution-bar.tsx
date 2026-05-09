import { useState, useMemo } from "react"
import { ShieldCheck } from "lucide-react"
import { useAccount, useReadContract } from "wagmi"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useResolveMarket } from "@/features/market/hooks/use-resolve-market"
import { getOutcomeSlots } from "@/features/positions/lib/utils"
import { PREDICTION_MARKET_ABI, PREDICTION_MARKET_ADDRESS } from "@/lib/contracts"
import type { Market } from "@/features/market/types"

interface Props {
  market: Market
}

export function ResolutionBar({ market }: Props) {
  const { address } = useAccount()
  const slots = getOutcomeSlots(market)
  const [selected, setSelected] = useState<number | null>(null)

  // Authorization is decided by the contract, not the BE. Read on-chain creator/oracle
  // so the visibility gate matches what `resolveMarket` will actually accept.
  const { data: onChainMarket } = useReadContract({
    address: PREDICTION_MARKET_ADDRESS,
    abi: PREDICTION_MARKET_ABI,
    functionName: "markets",
    args: [BigInt(market.marketId)],
  })

  const onChainCreator = onChainMarket?.[0]
  const onChainOracle = onChainMarket?.[1]

  const canSeeResolver =
    address &&
    onChainCreator &&
    (address.toLowerCase() === onChainCreator.toLowerCase() ||
      (onChainOracle && address.toLowerCase() === onChainOracle.toLowerCase()))

  // Payouts computed at render time so useSimulateContract can react to selection changes
  const payouts = useMemo((): bigint[] => {
    if (selected === null) return []
    return slots.map((_, i) => (i === selected ? 1n : 0n))
  }, [selected, slots])

  const { resolveMarket, isPending, canResolve, simulateError } = useResolveMarket(market, payouts)

  const revertReason =
    simulateError && "shortMessage" in simulateError
      ? (simulateError as { shortMessage?: string }).shortMessage ?? simulateError.message
      : simulateError?.message

  if (!canSeeResolver) return null
  if (market.status !== "open" && market.status !== "pending") return null

  async function handleResolve() {
    try {
      await resolveMarket()
    } catch {
      // toast already shown
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-amber-400">
        <ShieldCheck className="size-3.5" aria-hidden />
        Oracle — Resolve Market
      </div>

      <div className="flex flex-wrap gap-2">
        {slots.map((slot, i) => (
          <button
            key={slot.label}
            onClick={() => setSelected(i === selected ? null : i)}
            aria-pressed={selected === i}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors duration-100",
              selected === i
                ? "bg-amber-500/20 ring-1 ring-amber-500/50 text-amber-300"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            {slot.label}
          </button>
        ))}
      </div>

      <Button
        onClick={handleResolve}
        disabled={!canResolve || isPending}
        variant="outline"
        title={selected === null ? "Select an outcome first" : revertReason}
        className="self-start border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 disabled:opacity-40"
      >
        {isPending ? "Resolving…" : "Resolve Market"}
      </Button>

      {selected !== null && revertReason ? (
        <p className="text-[11px] text-red-400">{revertReason}</p>
      ) : null}
    </div>
  )
}