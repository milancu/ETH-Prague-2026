import { useState } from "react"
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { parseEventLogs, type Hex } from "viem"
import { PREDICTION_MARKET_ABI } from "@/lib/contracts"
import { postMarket } from "@/features/market/api/markets"
import { postDiceCommit, postDiceLink } from "@/features/dice/api/dice"
import { saveDiceRecord, patchDiceRecord } from "@/features/dice/lib/storage"
import type { DiceCreateFormInput } from "@/features/dice/lib/schema"
import type { TxStep } from "@/features/chat/schema"

const TARGET_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "84532")
const TOAST_ID = "dice-create"

const DICE_OUTCOME_LABELS = ["1", "2", "3", "4", "5", "6"]

export function useCreateDiceMarket() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [isPending, setIsPending] = useState(false)

  async function send(step: TxStep): Promise<Hex> {
    return sendTransactionAsync({
      to: step.to as `0x${string}`,
      data: step.data as Hex,
      value: BigInt(step.value),
    })
  }

  async function createDiceMarket(data: DiceCreateFormInput) {
    if (!address) throw new Error("Wallet not connected")
    if (!publicClient) throw new Error("RPC client not ready")

    setIsPending(true)
    try {
      if (chainId !== TARGET_CHAIN_ID) {
        toast.loading("Switching network…", { id: TOAST_ID })
        await switchChainAsync({ chainId: TARGET_CHAIN_ID })
      }

      // 1. Backend creates the commitment + builds the createMarket TxCard.
      toast.loading("Reserving cosmic beacon block…", { id: TOAST_ID })
      const commitRes = await postDiceCommit({
        name: data.title,
        description: data.description ?? "",
        delay_minutes: data.delayMinutes,
        user_address: address,
        chain_id: TARGET_CHAIN_ID,
      })

      const { tx_card, commitment } = commitRes

      saveDiceRecord({
        commitmentId: commitment.id,
        commitmentHash: commitment.commitment_hash,
        marketId: null,
        title: data.title,
        chainId: TARGET_CHAIN_ID,
        targetSequence: commitment.target_sequence,
        estimatedRevealUnix: commitment.estimated_reveal_unix,
        delayMinutes: commitment.delay_minutes,
        createdAtUnix: Math.floor(Date.now() / 1000),
        result: null,
      })

      // 2. Sign each `requires` step (TAB approve), then the main createMarket.
      const stepCount = tx_card.requires.length + 1
      for (let i = 0; i < tx_card.requires.length; i++) {
        const step = tx_card.requires[i]
        toast.loading(
          `Step ${i + 1}/${stepCount}: ${step.summary}`,
          { id: TOAST_ID },
        )
        const hash = await send(step)
        await publicClient.waitForTransactionReceipt({ hash })
      }

      toast.loading(`Step ${stepCount}/${stepCount}: Creating dice market…`, {
        id: TOAST_ID,
      })
      const mainHash = await send(tx_card)
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: mainHash,
      })

      const [event] = parseEventLogs({
        abi: PREDICTION_MARKET_ABI,
        logs: receipt.logs,
        eventName: "MarketCreated",
      })
      if (!event) {
        throw new Error("MarketCreated event missing from receipt")
      }
      const marketId = Number(event.args.marketId)

      // 3. Link on-chain market_id back to the commitment.
      toast.loading("Linking market to cosmic commitment…", { id: TOAST_ID })
      await postDiceLink(commitment.id, marketId)
      patchDiceRecord(commitment.id, { marketId })

      // 4. Best-effort BE sync so the market shows up in lists. Mirrors
      //    use-create-market.ts; failure is non-fatal — market is on-chain.
      try {
        await postMarket({
          market_id: marketId,
          condition_id: event.args.conditionId,
          tx_hash: mainHash,
          chain_id: TARGET_CHAIN_ID,
          creator: address,
          title: data.title,
          description: data.description ?? null,
          rules: null,
          category: "dice",
          outcome_type: "multi",
          outcomes: DICE_OUTCOME_LABELS.map((label) => ({ label })),
          expires_at: new Date(
            commitment.estimated_reveal_unix * 1000,
          ).toISOString(),
          resolution_time: new Date(
            (commitment.estimated_reveal_unix + 60) * 1000,
          ).toISOString(),
        })
      } catch {
        /* on-chain state is authoritative — refresh either way */
      }

      queryClient.invalidateQueries({ queryKey: ["markets"] })
      toast.success("Cosmic dice market created!", { id: TOAST_ID })

      // 5. Hand off to the reveal screen.
      navigate({ to: "/dice/$commitmentId", params: { commitmentId: String(commitment.id) } })

      return { commitmentId: commitment.id, marketId }
    } catch (err) {
      const rejected =
        err instanceof Error &&
        /reject|denied|user/i.test(err.message)
      if (rejected) toast.dismiss(TOAST_ID)
      else
        toast.error(
          err instanceof Error
            ? err.message.split("\n")[0]
            : "Failed to create dice market",
          { id: TOAST_ID },
        )
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { createDiceMarket, isPending }
}
