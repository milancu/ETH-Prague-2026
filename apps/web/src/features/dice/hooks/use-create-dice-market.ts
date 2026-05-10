import { useEffect, useState } from "react"
import { useAccount, useSwitchChain, useWriteContract } from "wagmi"
import { readContract, simulateContract, waitForTransactionReceipt } from "wagmi/actions"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { parseEventLogs, maxUint256, BaseError } from "viem"
import { config } from "@/config"
import {
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_ADDRESS,
  TABCOIN_ADDRESS,
  ERC20_ABI,
  DEFAULT_BOND,
  OUTCOME_TYPE,
} from "@/lib/contracts"
import { postMarket } from "@/features/market/api/markets"
import { postDiceCommit, postDiceLink } from "@/features/dice/api/dice"
import {
  saveDiceRecord,
  patchDiceRecord,
  purgeOrphanDiceRecords,
} from "@/features/dice/lib/storage"
import type { DiceCreateFormInput } from "@/features/dice/lib/schema"

const TARGET_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "84532")
const TOAST_ID = "dice-create"

const DICE_OUTCOME_LABELS = ["1", "2", "3", "4", "5", "6"] as const
const DICE_SLOT_COUNT = 6n
const RESOLUTION_BUFFER_SEC = 60n
// Floor on `expiresAt`: never less than `now + EXPIRY_SAFETY_SEC` to avoid
// `ExpiresInPast` reverts when the beacon timestamp lags wall-clock.
const EXPIRY_SAFETY_SEC = 120n

export function useCreateDiceMarket() {
  const { address, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [isPending, setIsPending] = useState(false)

  // Drop unrecoverable commitments (createMarket never succeeded) on mount.
  useEffect(() => {
    purgeOrphanDiceRecords()
  }, [])

  async function createDiceMarket(data: DiceCreateFormInput) {
    if (!address) throw new Error("Wallet not connected")

    setIsPending(true)
    try {
      if (chainId !== TARGET_CHAIN_ID) {
        toast.loading("Switching network…", { id: TOAST_ID })
        await switchChainAsync({ chainId: TARGET_CHAIN_ID })
      }

      // 1. Reserve a beacon block via BE. We only consume `commitment` —
      //    BE's tx_card is ignored; FE builds the createMarket call itself.
      toast.loading("Reserving cosmic beacon block…", { id: TOAST_ID })
      const { commitment } = await postDiceCommit({
        name: data.title,
        description: data.description ?? "",
        delay_minutes: data.delayMinutes,
        user_address: address,
        chain_id: TARGET_CHAIN_ID,
      })

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

      // 2. Build createMarket params. Floor expiresAt at now + safety buffer
      //    so a stale beacon timestamp can't trigger ExpiresInPast.
      const nowSec = BigInt(Math.floor(Date.now() / 1000))
      const beaconExpiry = BigInt(commitment.estimated_reveal_unix)
      const expiresAt =
        beaconExpiry > nowSec + EXPIRY_SAFETY_SEC
          ? beaconExpiry
          : nowSec + EXPIRY_SAFETY_SEC
      const resolutionTime = expiresAt + RESOLUTION_BUFFER_SEC

      // 3. Pre-flight: TAB balance must cover the bond.
      const balance = await readContract(config, {
        address: TABCOIN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })
      if (balance < DEFAULT_BOND) {
        throw new Error(
          `Insufficient TAB balance. You have ${balance / 10n ** 18n} TAB, need ${DEFAULT_BOND / 10n ** 18n} TAB to post the bond.`,
        )
      }

      // 4. Approve TAB if allowance < bond. Skip otherwise.
      const allowance = await readContract(config, {
        address: TABCOIN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, PREDICTION_MARKET_ADDRESS],
      })
      const needsApproval = allowance < DEFAULT_BOND
      if (needsApproval) {
        toast.loading("Step 1/2: Approving TAB…", { id: TOAST_ID })
        const approveHash = await writeContractAsync({
          address: TABCOIN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [PREDICTION_MARKET_ADDRESS, maxUint256],
        })
        const approveReceipt = await waitForTransactionReceipt(config, {
          hash: approveHash,
        })
        if (approveReceipt.status !== "success") {
          throw new Error(`TAB approval reverted on-chain (tx ${approveHash}).`)
        }
      }

      // 5. Simulate first so we get a real revert reason instead of a wallet
      //    "internal error" when the call would fail.
      toast.loading(
        needsApproval ? "Step 2/2: Creating dice market…" : "Creating dice market…",
        { id: TOAST_ID },
      )
      const sim = await simulateContract(config, {
        account: address,
        address: PREDICTION_MARKET_ADDRESS,
        abi: PREDICTION_MARKET_ABI,
        functionName: "createMarket",
        args: [
          {
            name:             data.title,
            description:      data.description ?? "",
            category:         "dice",
            outcomeType:      OUTCOME_TYPE.multi,
            outcomeSlotCount: DICE_SLOT_COUNT,
            outcomeLabels:    [...DICE_OUTCOME_LABELS],
            oracle:           address,
            expiresAt,
            resolutionTime,
          },
        ],
      })

      // 6. Sign + wait. Simulate already validated, so a revert here is rare
      //    (state-change race) but still surfaced via receipt.status.
      const txHash = await writeContractAsync(sim.request)
      const receipt = await waitForTransactionReceipt(config, { hash: txHash })
      if (receipt.status !== "success") {
        throw new Error(`createMarket reverted on-chain (tx ${txHash}).`)
      }

      const [event] = parseEventLogs({
        abi: PREDICTION_MARKET_ABI,
        logs: receipt.logs,
        eventName: "MarketCreated",
      })
      if (!event) throw new Error("MarketCreated event missing from receipt")
      const marketId = Number(event.args.marketId)

      // 7. Link commitment ↔ market_id; persist to BE catalog (best effort).
      toast.loading("Linking market to cosmic commitment…", { id: TOAST_ID })
      await postDiceLink(commitment.id, marketId)
      patchDiceRecord(commitment.id, { marketId })

      try {
        await postMarket({
          market_id: marketId,
          condition_id: event.args.conditionId,
          tx_hash: txHash,
          chain_id: TARGET_CHAIN_ID,
          creator: address,
          title: data.title,
          description: data.description ?? null,
          rules: null,
          category: "dice",
          outcome_type: "multi",
          outcomes: DICE_OUTCOME_LABELS.map((label) => ({ label })),
          expires_at: new Date(Number(expiresAt) * 1000).toISOString(),
          resolution_time: new Date(Number(resolutionTime) * 1000).toISOString(),
        })
      } catch {
        /* on-chain state is authoritative */
      }

      queryClient.invalidateQueries({ queryKey: ["markets"] })
      toast.success("Cosmic dice market created!", { id: TOAST_ID })

      navigate({
        to: "/dice/$commitmentId",
        params: { commitmentId: String(commitment.id) },
      })

      return { commitmentId: commitment.id, marketId }
    } catch (err) {
      const rejected =
        err instanceof Error && /reject|denied|user/i.test(err.message)
      if (rejected) {
        toast.dismiss(TOAST_ID)
      } else {
        const msg =
          err instanceof BaseError
            ? err.shortMessage
            : err instanceof Error
              ? err.message.split("\n")[0]
              : "Failed to create dice market"
        toast.error(msg, { id: TOAST_ID })
      }
      throw err
    } finally {
      setIsPending(false)
    }
  }

  return { createDiceMarket, isPending }
}
