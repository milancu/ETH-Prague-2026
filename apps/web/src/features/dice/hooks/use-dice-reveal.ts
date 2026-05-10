import { useCallback, useEffect, useRef, useState } from "react"
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
} from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Hex } from "viem"
import { postDiceReveal } from "@/features/dice/api/dice"
import { patchDiceRecord, getDiceRecord } from "@/features/dice/lib/storage"
import { patchMarketStatus } from "@/features/market/api/markets"
import type { DiceRevealResponse } from "@/features/dice/lib/schema"

const TOAST_ID = "dice-reveal"

const DEFAULT_POLL_INTERVAL_MS = 15_000

interface UseDiceRevealArgs {
  commitmentId: number
  chainId: number
  /** Skip polling — used when the consumer hasn't loaded yet. */
  enabled?: boolean
}

interface UseDiceRevealResult {
  state: DiceRevealResponse | null
  isPolling: boolean
  isResolving: boolean
  error: string | null
  /** Manually re-poll. */
  refetch: () => Promise<void>
  /** Sign the resolveMarket TxCard (only valid when state.status === "tx_card_created"). */
  resolve: () => Promise<void>
}

export function useDiceReveal({
  commitmentId,
  chainId,
  enabled = true,
}: UseDiceRevealArgs): UseDiceRevealResult {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()

  const [state, setState] = useState<DiceRevealResponse | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs let the polling loop see the latest values without restarting on every render.
  const stateRef = useRef(state)
  stateRef.current = state

  const fetchOnce = useCallback(async () => {
    setIsPolling(true)
    try {
      const res = await postDiceReveal(commitmentId, chainId)
      setState(res)
      setError(null)
      if (res.status === "already_revealed") {
        patchDiceRecord(commitmentId, { result: res.die })
      } else if (res.status === "tx_card_created") {
        patchDiceRecord(commitmentId, { result: res.die })
      }
      return res
    } catch (err) {
      // BE may return `{error: "..."}` (axios resolves) or a 4xx/5xx (axios
      // rejects with response.data.detail). Surface the friendliest available
      // message so the UI never falls back to a generic "Reveal failed".
      let reason = ""
      if (err && typeof err === "object" && "response" in err) {
        const data = (err as { response?: { data?: unknown } }).response?.data
        if (data && typeof data === "object") {
          const d = data as Record<string, unknown>
          if (typeof d.error === "string") reason = d.error
          else if (typeof d.detail === "string") reason = d.detail
        }
      }
      if (!reason && err instanceof Error) reason = err.message.split("\n")[0]
      if (!reason || reason.trim().length < 3) reason = "Reveal poll failed"
      setError(reason)
      throw err
    } finally {
      setIsPolling(false)
    }
  }, [commitmentId, chainId])

  // Auto-poll when not_ready. Stops once we get a TxCard or an already-revealed.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (cancelled) return
      let res: DiceRevealResponse | null = null
      try {
        res = await fetchOnce()
      } catch {
        // Silent retry — fetchOnce already surfaced via state.error.
      }
      if (cancelled) return
      // Re-poll only while still pending. Use eta_seconds when available so we
      // don't hammer the BE (capped to a sane minimum/maximum).
      if (res && res.status === "not_ready") {
        const wait = Math.min(
          Math.max(res.eta_seconds * 1000, 5_000),
          DEFAULT_POLL_INTERVAL_MS,
        )
        timer = setTimeout(tick, wait)
      } else if (!res) {
        timer = setTimeout(tick, DEFAULT_POLL_INTERVAL_MS)
      }
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // We intentionally only depend on the fetchOnce identity so that when
    // commitmentId/chainId change, the poll loop restarts.
  }, [fetchOnce, enabled])

  const resolve = useCallback(async () => {
    const current = stateRef.current
    if (!current || current.status !== "tx_card_created") {
      throw new Error("No resolve TxCard available")
    }
    if (!address) throw new Error("Wallet not connected")
    if (!publicClient) throw new Error("RPC client not ready")

    setIsResolving(true)
    try {
      const card = current.tx_card
      if (chainId !== card.chain_id) {
        toast.loading("Switching network…", { id: TOAST_ID })
        await switchChainAsync({ chainId: card.chain_id })
      }

      // Resolve has no requires[] in the BE flow today, but loop over them
      // defensively in case that changes (e.g. an oracle-permission step).
      const stepCount = card.requires.length + 1
      for (let i = 0; i < card.requires.length; i++) {
        const step = card.requires[i]
        toast.loading(`Step ${i + 1}/${stepCount}: ${step.summary}`, {
          id: TOAST_ID,
        })
        const hash = await sendTransactionAsync({
          to: step.to as `0x${string}`,
          data: step.data as Hex,
          value: BigInt(step.value),
        })
        await publicClient.waitForTransactionReceipt({ hash })
      }

      toast.loading(`Step ${stepCount}/${stepCount}: Resolving market…`, {
        id: TOAST_ID,
      })
      const mainHash = await sendTransactionAsync({
        to: card.to as `0x${string}`,
        data: card.data as Hex,
        value: BigInt(card.value),
      })
      await publicClient.waitForTransactionReceipt({ hash: mainHash })

      // Sync market status to BE (best-effort).
      const rec = getDiceRecord(commitmentId)
      if (rec?.marketId !== null && rec?.marketId !== undefined) {
        try {
          await patchMarketStatus(rec.marketId, "resolved")
        } catch {
          /* on-chain authoritative */
        }
      }

      patchDiceRecord(commitmentId, { result: current.die })
      queryClient.invalidateQueries({ queryKey: ["markets"] })
      toast.success(`Cosmic dice rolled: ${current.die}`, { id: TOAST_ID })
    } catch (err) {
      const rejected =
        err instanceof Error && /reject|denied|user/i.test(err.message)
      if (rejected) toast.dismiss(TOAST_ID)
      else
        toast.error(
          err instanceof Error
            ? err.message.split("\n")[0]
            : "Failed to resolve dice market",
          { id: TOAST_ID },
        )
      throw err
    } finally {
      setIsResolving(false)
    }
  }, [
    address,
    chainId,
    commitmentId,
    publicClient,
    queryClient,
    sendTransactionAsync,
    switchChainAsync,
  ])

  return {
    state,
    isPolling,
    isResolving,
    error,
    refetch: async () => {
      try {
        await fetchOnce()
      } catch {
        /* error already in state */
      }
    },
    resolve,
  }
}
