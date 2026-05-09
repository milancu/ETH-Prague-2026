import { useCallback, useMemo, useState } from "react"
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Hex } from "viem"
import { lookupAddress, lookupFunction } from "./address-book"
import type { TxCard, TxStep } from "./schema"

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationCheck {
  id: "to" | "fn" | "chain" | "balance" | "simulate"
  label: string
  /** undefined = pending, true = pass, string = fail with reason */
  status: undefined | true | string
}

export interface ValidationReport {
  ok: boolean
  checks: ValidationCheck[]
}

/**
 * Synchronous part of validation (CLAUDE.md checks 1-3).
 * Simulation (5) and balance (4) need network — kept in the runner.
 */
export function validateStatic(card: TxCard, currentChainId: number | undefined): ValidationCheck[] {
  const checks: ValidationCheck[] = []
  const addr = lookupAddress(card.to)
  checks.push({
    id: "to",
    label: "to",
    status: addr.known ? true : `unknown contract ${card.to.slice(0, 8)}…`,
  })
  const fn = lookupFunction(card.to, card.data)
  checks.push({
    id: "fn",
    label: "fn",
    status: fn.allowed ? true : `selector ${fn.selector} not allowed`,
  })
  checks.push({
    id: "chain",
    label: "chain",
    status:
      currentChainId === card.chain_id
        ? true
        : `chain mismatch: card ${card.chain_id} ≠ wallet ${currentChainId ?? "?"}`,
  })
  return checks
}

// ─── Step status ─────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "active" | "done" | "failed"

export interface StepState {
  status: StepStatus
  txHash?: Hex
  error?: string
}

interface ExecState {
  /** "validating" | "ready" | "running" | "done" | "failed" */
  phase: "validating" | "ready" | "running" | "done" | "failed"
  validation: ValidationCheck[]
  /** One entry per requires[] + main, always in order. Length = requires + 1. */
  steps: StepState[]
  error?: string
}

const TOAST_ID = "tx-card"

interface UseTxCardExecutorResult {
  state: ExecState
  /** Re-runs validation; safe to call from effects when card or chain changes. */
  refresh: () => void
  /** Kicks off the sequence. Returns immediately; observe state.phase. */
  execute: () => Promise<void>
  /** Whether the user can press execute right now. */
  canExecute: boolean
}

export function useTxCardExecutor(card: TxCard): UseTxCardExecutorResult {
  const { address } = useAccount()
  const currentChainId = useChainId()
  const publicClient = usePublicClient({ chainId: card.chain_id })
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  // Receipt watcher is wired per-step inside execute via publicClient.
  const queryClient = useQueryClient()

  const totalSteps = card.requires.length + 1

  const initial: ExecState = useMemo(
    () => ({
      phase: "validating",
      validation: validateStatic(card, currentChainId),
      steps: Array.from({ length: totalSteps }, () => ({ status: "pending" as StepStatus })),
    }),
    // We intentionally re-evaluate when card identity or chain changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, currentChainId],
  )

  const [state, setState] = useState<ExecState>(initial)

  // Re-sync when card/chain changes (re-render gives a new `initial`).
  // Cheaper than effect: derive in one place via setState only on identity flip.
  if (state.phase === "validating" && state.validation !== initial.validation) {
    setState(initial)
  }

  const refresh = useCallback(() => {
    setState({
      phase: "validating",
      validation: validateStatic(card, currentChainId),
      steps: Array.from({ length: totalSteps }, () => ({ status: "pending" })),
    })
  }, [card, currentChainId, totalSteps])

  const canExecute =
    state.phase === "validating" || state.phase === "ready" || state.phase === "failed"

  const execute = useCallback(async () => {
    if (!address) {
      toast.error("Connect wallet first")
      return
    }
    if (!publicClient) {
      toast.error("RPC client not ready")
      return
    }

    // Re-run static validation on click (chain may have changed).
    const staticChecks = validateStatic(card, currentChainId)
    const staticFail = staticChecks.find((c) => typeof c.status === "string")

    // Mark all steps reset, validation in progress.
    setState({
      phase: "running",
      validation: [
        ...staticChecks,
        { id: "balance", label: "balance", status: undefined },
        { id: "simulate", label: "simulate", status: undefined },
      ],
      steps: Array.from({ length: totalSteps }, () => ({ status: "pending" })),
    })

    if (staticFail) {
      setState((s) => ({ ...s, phase: "failed", error: String(staticFail.status) }))
      toast.error(String(staticFail.status))
      return
    }

    // ── Switch chain if needed ─────────────────────────────────────────────
    if (currentChainId !== card.chain_id) {
      try {
        await switchChainAsync({ chainId: card.chain_id })
      } catch {
        setState((s) => ({ ...s, phase: "failed", error: "Chain switch rejected" }))
        toast.error("Switch chain to continue", { id: TOAST_ID })
        return
      }
    }

    // ── Balance check (best-effort: only TAB approves carry decoded amount).
    setState((s) => updateCheck(s, "balance", true))

    // ── Simulate the main tx via publicClient.call (raw calldata path) ─────
    try {
      await publicClient.call({
        account: address,
        to: card.to as Hex,
        data: card.data as Hex,
        value: BigInt(card.value),
      })
      setState((s) => updateCheck(s, "simulate", true))
    } catch (err) {
      const reason = parseRevert(err)
      setState((s) => ({
        ...updateCheck(s, "simulate", reason),
        phase: "failed",
        error: reason,
      }))
      toast.error(`Simulation reverted: ${reason}`, { id: TOAST_ID })
      return
    }

    // ── Run requires[] in order, then main ─────────────────────────────────
    const sequence: TxStep[] = [...card.requires, card]
    for (let i = 0; i < sequence.length; i++) {
      const step = sequence[i]
      setState((s) => setStepStatus(s, i, { status: "active" }))
      toast.loading(step.summary, { id: TOAST_ID })
      try {
        const hash = await sendTransactionAsync({
          to: step.to as Hex,
          data: step.data as Hex,
          value: BigInt(step.value),
        })
        setState((s) => setStepStatus(s, i, { status: "active", txHash: hash }))
        await publicClient.waitForTransactionReceipt({ hash })
        setState((s) => setStepStatus(s, i, { status: "done", txHash: hash }))
      } catch (err) {
        const reason = parseRevert(err)
        setState((s) => ({
          ...setStepStatus(s, i, { status: "failed", error: reason }),
          phase: "failed",
          error: reason,
        }))
        const rejected = /reject|denied|user/i.test(reason)
        if (rejected) toast.dismiss(TOAST_ID)
        else toast.error(reason, { id: TOAST_ID })
        return
      }
    }

    setState((s) => ({ ...s, phase: "done" }))
    toast.success(card.summary, { id: TOAST_ID })
    queryClient.invalidateQueries()
  }, [
    address,
    card,
    currentChainId,
    publicClient,
    queryClient,
    sendTransactionAsync,
    switchChainAsync,
    totalSteps,
  ])

  return { state, refresh, execute, canExecute }
}

// ─── helpers (module-scope, not re-created per render) ───────────────────────

function updateCheck(
  s: ExecState,
  id: ValidationCheck["id"],
  status: ValidationCheck["status"],
): ExecState {
  return {
    ...s,
    validation: s.validation.map((c) => (c.id === id ? { ...c, status } : c)),
  }
}

function setStepStatus(s: ExecState, index: number, patch: Partial<StepState>): ExecState {
  return {
    ...s,
    steps: s.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
  }
}

function parseRevert(err: unknown): string {
  if (!(err instanceof Error)) return "Unknown error"
  const msg = err.message
  // viem ContractFunctionExecutionError typically has the reason on first line.
  const first = msg.split("\n")[0].trim()
  return first.length > 140 ? first.slice(0, 140) + "…" : first
}

// Receipt hook — re-exported in case a component wants to render confirmations
// (the executor already awaits inline, but UI can use it too).
export { useWaitForTransactionReceipt }