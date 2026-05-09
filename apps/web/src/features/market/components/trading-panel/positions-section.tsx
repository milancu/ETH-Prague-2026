import { useState } from "react"
import { parseEther } from "viem"
import { Layers } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useSplit } from "@/features/market/hooks/use-split"
import { useWrap } from "@/features/market/hooks/use-wrap"
import type { OutcomeSlot } from "@/features/positions/lib/utils"
import type { Market } from "@/features/market/types"
import { slotPalette, fmtAmt } from "./shared"
import { AmountInput, InlineWarn, PositionRow } from "./components"
import { useAccount } from "wagmi"
import { useReadContract } from "wagmi"
import { ERC20_ABI, TABCOIN_ADDRESS } from "@/lib/contracts"
import { formatEther } from "viem"

interface Props {
  market: Market
  slots: OutcomeSlot[]
  rawBalances: bigint[]
  erc20Balances: bigint[]
  wrappers: (`0x${string}` | null)[]
  onRefetch: () => void
}

export function PositionsSection({ market, slots, rawBalances, erc20Balances, wrappers, onRefetch }: Props) {
  const { address } = useAccount()
  const { split, isPending: splitting } = useSplit()
  const { wrap, wrapping } = useWrap()

  const [mintAmount, setMintAmount] = useState("")

  const hasAnyPosition = rawBalances.some(b => b > 0n) || erc20Balances.some(b => b > 0n)

  const { data: tabBalanceRaw } = useReadContract({
    address: TABCOIN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, staleTime: 15_000 },
  })
  const tabBalanceNum = parseFloat(formatEther((tabBalanceRaw ?? 0n) as bigint))

  async function handleMint() {
    if (!mintAmount || Number(mintAmount) <= 0) return
    try {
      await split({ market, tabAmountWei: parseEther(mintAmount) })
      setMintAmount("")
      onRefetch()
    } catch { /* toast handled */ }
  }

  async function handleWrap(i: number) {
    const raw = rawBalances[i]
    if (raw === 0n) return
    try {
      await wrap({ market, indexSet: slots[i].indexSet, amount: raw })
      onRefetch()
    } catch { /* toast handled */ }
  }

  return (
    <div className="flex flex-col">
      {/* ── Positions ── */}
      <div className="border-t border-border">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Layers className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Positions</span>
        </div>
        {!address ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">Connect wallet to see positions.</p>
        ) : !hasAnyPosition ? (
          <p className="px-4 pb-4 text-[11px] text-muted-foreground/60">No positions yet — mint below.</p>
        ) : (
          <>
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-1.5">
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">ERC-1155</span>
              <span />
              <span className="text-right text-[9px] uppercase tracking-widest text-muted-foreground/40 font-semibold">ERC-20</span>
            </div>
            <div className="grid grid-cols-[52px_1fr_48px_1fr] items-center gap-x-2 px-4 pb-2">
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">raw · illiquid</span>
              <span />
              <span className="text-right text-[9px] text-muted-foreground/30">tradeable</span>
            </div>
            {slots.map((slot, i) => (
              <PositionRow
                key={slot.label}
                label={slot.label}
                raw={rawBalances[i]}
                wrapped={erc20Balances[i]}
                wrapperExists={wrappers[i] !== null}
                palette={slotPalette(i, market)}
                isWrapping={wrapping === slot.indexSet}
                onWrap={() => handleWrap(i)}
              />
            ))}
          </>
        )}
      </div>

      {/* ── Mint ── */}
      <div className="flex flex-col gap-3 border-t border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Mint</span>
          <span className="text-[10px] text-muted-foreground/35">1 TAB → 1 YES + 1 NO (ERC-1155)</span>
        </div>
        <div className="flex gap-2">
          <AmountInput
            value={mintAmount} onChange={setMintAmount}
            unit="TAB" label="TABcoin to split into outcome positions"
            disabled={splitting}
          />
          <Button
            onClick={handleMint}
            disabled={Number(mintAmount) <= 0 || splitting || (tabBalanceNum > 0 && parseFloat(mintAmount) > tabBalanceNum)}
            className="shrink-0 active:scale-[0.97]"
          >
            {splitting ? "Minting…" : "Mint"}
          </Button>
        </div>
        {tabBalanceNum > 0 && parseFloat(mintAmount) > tabBalanceNum && (
          <InlineWarn variant="error">
            Nedostatek TAB. Máš {fmtAmt(tabBalanceNum, 2)} TAB
          </InlineWarn>
        )}
        {parseFloat(mintAmount) > 0 && parseFloat(mintAmount) <= tabBalanceNum && (
          <div className="flex flex-wrap items-center gap-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            <span className="text-[10px] text-muted-foreground/50">Získáš</span>
            {slots.map((slot, i) => {
              const pal = slotPalette(i, market)
              return (
                <span key={slot.label} className="flex items-center gap-1">
                  <span className={cn("font-mono text-[11px] font-semibold tabular-nums", pal.text)}>{mintAmount}</span>
                  <span className={cn("text-[10px] font-bold tracking-wide", pal.text)}>{slot.label}</span>
                  {i < slots.length - 1 && <span className="text-muted-foreground/40 text-[10px] mx-0.5">+</span>}
                </span>
              )
            })}
            <span className="text-[10px] text-muted-foreground/35">→ Wrap pro obchodování</span>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground/35">
          Raw tokeny nelze obchodovat — použij <strong className="text-muted-foreground/50">Wrap →</strong> výše pro převod na ERC-20.
        </p>
      </div>
    </div>
  )
}