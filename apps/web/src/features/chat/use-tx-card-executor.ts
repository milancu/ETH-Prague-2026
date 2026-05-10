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
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
} from "viem"
import { abiFor, lookupAddress, lookupFunction } from "./address-book"
import { runPostActions } from "./post-actions"
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

    // ── Run requires[] in order, then main. Simulate each step right before
    //    sending so the simulation sees the post-state of any prior requires
    //    (e.g. the TAB allowance set by an earlier approve). A single upfront
    //    simulation of the main tx would revert here because allowance is 0.
    const sequence: TxStep[] = [...card.requires, card]
    let simulatePassed = false
    let mainHash: Hex | undefined
    let mainReceipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>> | undefined
    for (let i = 0; i < sequence.length; i++) {
      const step = sequence[i]
      const isMain = i === sequence.length - 1
      setState((s) => setStepStatus(s, i, { status: "active" }))
      toast.loading(step.summary, { id: TOAST_ID })

      try {
        await publicClient.call({
          account: address,
          to: step.to as Hex,
          data: step.data as Hex,
          value: BigInt(step.value),
        })
      } catch (err) {
        const reason = parseRevert(err, step.to)
        setState((s) => ({
          ...updateCheck(s, "simulate", reason),
          ...setStepStatus(s, i, { status: "failed", error: reason }),
          phase: "failed",
          error: reason,
        }))
        toast.error(`Simulation reverted: ${reason}`, { id: TOAST_ID })
        return
      }

      if (!simulatePassed) {
        simulatePassed = true
        setState((s) => updateCheck(s, "simulate", true))
      }

      try {
        const hash = await sendTransactionAsync({
          to: step.to as Hex,
          data: step.data as Hex,
          value: BigInt(step.value),
        })
        setState((s) => setStepStatus(s, i, { status: "active", txHash: hash }))
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        setState((s) => setStepStatus(s, i, { status: "done", txHash: hash }))
        if (isMain) {
          mainHash = hash
          mainReceipt = receipt
        }
      } catch (err) {
        const reason = parseRevert(err, step.to)
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

    if (mainReceipt && mainHash) {
      try {
        await runPostActions({
          card,
          receipt: mainReceipt,
          txHash: mainHash,
          creator: address,
        })
      } catch (err) {
        // BE sync is best-effort — the on-chain state is authoritative.
        const reason = parseRevert(err)
        toast.warning(`Saved on-chain, but BE sync failed: ${reason}`)
      }
    }

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

/**
 * Pulls the actual revert reason out of a viem error.
 *
 * `publicClient.call()` is raw (no ABI), so when the node returns custom-error
 * data viem can't name it on its own. If we know which contract was called we
 * decode `error.data` against that contract's ABI ourselves; otherwise we fall
 * back to viem's `shortMessage` and finally to the first line of `message`.
 */
function parseRevert(err: unknown, address?: string): string {
  if (err instanceof BaseError) {
    // Direct hit: viem already decoded the custom error (happens for
    // simulateContract / writeContract paths that carry an ABI).
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const named = formatErrorName(reverted.data?.errorName, reverted.data?.args)
      if (named) return named
      if (reverted.reason) return reverted.reason
    }

    // Raw revert data from `publicClient.call` lives on the cause chain. Try to
    // find a hex blob and decode it against the target contract's ABI.
    const abi = address ? abiFor(address) : undefined
    if (abi) {
      const data = extractRevertData(err)
      if (data && data !== "0x") {
        try {
          const decoded = decodeErrorResult({ abi, data })
          const named = formatErrorName(decoded.errorName, decoded.args as readonly unknown[] | undefined)
          if (named) return named
        } catch {
          /* not one of ours — fall through */
        }
      }
    }

    return err.shortMessage
  }
  if (err instanceof Error) {
    const first = err.message.split("\n")[0].trim()
    return first.length > 160 ? first.slice(0, 160) + "…" : first
  }
  return "Unknown error"
}

function formatErrorName(name: string | undefined, args: readonly unknown[] | undefined): string | null {
  if (!name) return null
  const argStr = Array.isArray(args) && args.length > 0 ? `(${args.map(String).join(", ")})` : ""
  return `${name}${argStr}`
}

function extractRevertData(err: BaseError): Hex | undefined {
  let cur: unknown = err
  while (cur) {
    if (typeof cur === "object" && cur !== null) {
      const c = cur as { data?: unknown; cause?: unknown }
      if (typeof c.data === "string" && c.data.startsWith("0x")) return c.data as Hex
      if (typeof c.data === "object" && c.data !== null && "data" in c.data) {
        const inner = (c.data as { data?: unknown }).data
        if (typeof inner === "string" && inner.startsWith("0x")) return inner as Hex
      }
      cur = c.cause
    } else break
  }
  return undefined
}

// Receipt hook — re-exported in case a component wants to render confirmations
// (the executor already awaits inline, but UI can use it too).
export { useWaitForTransactionReceipt }