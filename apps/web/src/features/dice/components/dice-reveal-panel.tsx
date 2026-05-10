import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  Link2Off,
  Loader2,
  Sparkles,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useDiceReveal } from "@/features/dice/hooks/use-dice-reveal"
import { getDiceRecord, type DiceLocalRecord } from "@/features/dice/lib/storage"
import { CosmicProgressRing } from "./cosmic-progress-ring"
import { CosmicConfetti } from "./cosmic-confetti"
import { DiceTumble } from "./dice-tumble"
import { DiceShareCard } from "./dice-share-card"

const EASE = [0.23, 1, 0.32, 1] as const

type DicePhase = "awaiting" | "ready" | "revealed" | "resolved"

function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface Props {
  commitmentId: number
}

export function DiceRevealPanel({ commitmentId }: Props) {
  const record = useMemo(() => getDiceRecord(commitmentId), [commitmentId])
  const chainId = record?.chainId ?? 31337

  // Only poll once we have a market linked — without it the BE rejects every
  // /reveal call with "No market_id linked to this commitment yet."
  const hasMarket = !!record && record.marketId !== null
  const { state, isPolling, isResolving, error, refetch, resolve } = useDiceReveal({
    commitmentId,
    chainId,
    enabled: hasMarket,
  })

  // Local tick — UI-only, doesn't drive the actual /reveal poll.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  // Optimistic flip after a successful resolveMarket tx — the hook's polling
  // stops after a TxCard, so we drive the resolved phase locally.
  const [justResolved, setJustResolved] = useState(false)

  if (!record) return <NotFoundView />
  if (record.marketId === null) return <NoMarketLinkedView record={record} />

  // Live ETA — derived from local clock so the countdown ticks every second.
  // The hook's `state.eta_seconds` is only refreshed on each poll (every 15s
  // in the worst case), which is why it appeared frozen.
  const etaSeconds = Math.max(0, record.estimatedRevealUnix - now)

  const phase: DicePhase =
    justResolved || state?.status === "already_revealed"
      ? "resolved"
      : state?.status === "tx_card_created"
        ? "revealed"
        : etaSeconds <= 0
          ? "ready"
          : "awaiting"

  const wasAlreadyResolved = state?.status === "already_revealed"

  const die =
    state?.status === "tx_card_created" || state?.status === "already_revealed"
      ? state.die
      : record.result ?? 0

  return (
    <PhaseSurface phase={phase}>
      <AnimatePresence mode="wait">
        {phase === "awaiting" || phase === "ready" ? (
          <AwaitingStage
            key="awaiting"
            record={record}
            etaSeconds={etaSeconds}
            isReady={phase === "ready"}
            isPolling={isPolling}
            error={error}
            onRefetch={() => void refetch()}
          />
        ) : phase === "revealed" ? (
          <RevealedStage
            key="revealed"
            die={die}
            record={record}
            isResolving={isResolving}
            onResolve={async () => {
              try {
                await resolve()
                setJustResolved(true)
              } catch {
                /* hook already toasted */
              }
            }}
          />
        ) : (
          <ResolvedStage
            key="resolved"
            die={die}
            record={record}
            fromPriorSession={wasAlreadyResolved && !justResolved}
          />
        )}
      </AnimatePresence>
    </PhaseSurface>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase surface — shared shell that swaps gradient + glow per phase.
// ─────────────────────────────────────────────────────────────────────────────

function PhaseSurface({
  phase,
  children,
}: {
  phase: DicePhase
  children: ReactNode
}) {
  const gradient =
    phase === "resolved"
      ? "from-emerald-500/[0.08] via-transparent to-transparent"
      : phase === "revealed"
        ? "from-purple-500/[0.10] via-emerald-500/[0.04] to-transparent"
        : phase === "ready"
          ? "from-purple-500/[0.14] via-purple-500/[0.04] to-transparent"
          : "from-purple-500/[0.06] via-transparent to-transparent"

  return (
    <motion.div
      layout
      transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
      className="relative overflow-hidden border border-border"
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-gradient-to-b transition-[background] duration-500",
          gradient,
        )}
      />
      {/* Soft starfield — pure CSS, decorative, near-zero cost */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-50 mix-blend-screen"
        style={{
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.7), transparent 50%), radial-gradient(1px 1px at 75% 65%, rgba(255,255,255,0.6), transparent 50%), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.5), transparent 50%), radial-gradient(1px 1px at 85% 20%, rgba(255,255,255,0.5), transparent 50%), radial-gradient(1.5px 1.5px at 55% 50%, rgba(255,255,255,0.4), transparent 50%)",
          backgroundSize: "100% 100%",
        }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Awaiting / Ready stage
// ─────────────────────────────────────────────────────────────────────────────

interface AwaitingProps {
  record: DiceLocalRecord
  etaSeconds: number
  isReady: boolean
  isPolling: boolean
  error: string | null
  onRefetch: () => void
}

function AwaitingStage({
  record,
  etaSeconds,
  isReady,
  isPolling,
  error,
  onRefetch,
}: AwaitingProps) {
  const total = Math.max(1, record.estimatedRevealUnix - record.createdAtUnix)
  const elapsed = Math.max(0, total - Math.max(0, etaSeconds))
  const progress = Math.min(1, elapsed / total)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex flex-col items-center gap-7 px-6 py-10 text-center"
    >
      <div className="inline-flex items-center gap-2 text-purple-300">
        <Sparkles className="size-4 animate-pulse" aria-hidden />
        <span className="text-[11px] uppercase tracking-widest font-semibold">
          {isReady ? "Capturing ray" : "Awaiting cosmic ray"}
        </span>
      </div>

      <CosmicProgressRing progress={progress} size={232} stroke={5}>
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-5xl tabular-nums tracking-tight">
            {formatCountdown(etaSeconds)}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {isReady ? "any second now" : "until reveal"}
          </span>
        </div>
      </CosmicProgressRing>

      <p className="max-w-sm text-xs text-muted-foreground">
        Beacon block{" "}
        <span className="font-mono text-foreground">
          #{record.targetSequence}
        </span>{" "}
        will derive a deterministic 6-sided outcome.
        {isReady ? (
          <> SpaceComputer is being polled — the reveal lands automatically.</>
        ) : (
          <> No need to wait here; auto-polls on reveal.</>
        )}
      </p>

      {/* Manual retry only matters once we're past the ETA — auto-polling
          handles the awaiting phase. We surface it on errors regardless. */}
      {(isReady || error) && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefetch}
          disabled={isPolling}
          className="active:scale-[0.97] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
        >
          {isPolling && <Loader2 className="size-3 animate-[spin_0.7s_linear_infinite]" aria-hidden />}
          Retry poll
        </Button>
      )}

      {error && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="size-3" aria-hidden />
          <span>
            {error.trim().length < 3 ? "Reveal poll failed — will retry" : error}
          </span>
        </p>
      )}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Revealed stage — die showed but market not yet resolved on-chain
// ─────────────────────────────────────────────────────────────────────────────

interface RevealedProps {
  die: number
  record: DiceLocalRecord
  isResolving: boolean
  onResolve: () => Promise<void>
}

function RevealedStage({ die, record, isResolving, onResolve }: RevealedProps) {
  const [tumbleDone, setTumbleDone] = useState(false)
  const reduce = useReducedMotion()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
      transition={{ duration: 0.3, ease: EASE }}
      className="relative flex flex-col items-center gap-6 px-6 py-10 text-center"
    >
      <div className="inline-flex items-center gap-2 text-purple-200">
        <Sparkles className="size-4" aria-hidden />
        <span className="text-[11px] uppercase tracking-widest font-semibold">
          Cosmic ray captured
        </span>
      </div>

      <div className="relative">
        <DiceTumble
          result={die}
          size={184}
          onSettle={() => setTumbleDone(true)}
        />
        <AnimatePresence>
          {tumbleDone && !reduce && (
            <CosmicConfetti key={`burst-${die}`} fireKey={die} />
          )}
        </AnimatePresence>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: tumbleDone ? 1 : 0, scale: tumbleDone ? 1 : 0.96 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="flex flex-col items-center gap-1"
      >
        <span className="font-mono text-5xl font-bold tabular-nums tracking-tight">
          {die}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          rolled · outcome locked
        </span>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: tumbleDone ? 1 : 0 }}
        transition={{ duration: 0.25, ease: EASE, delay: 0.05 }}
        className="max-w-sm text-xs text-muted-foreground"
      >
        Derived from beacon block{" "}
        <span className="font-mono text-foreground">
          #{record.targetSequence}
        </span>
        . Holders of outcome <strong>{die}</strong> can claim TAB once the
        market is resolved on-chain.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{
          opacity: tumbleDone ? 1 : 0,
          y: tumbleDone ? 0 : 4,
        }}
        transition={{ duration: 0.25, ease: EASE, delay: 0.1 }}
      >
        <Button
          onClick={() => void onResolve()}
          disabled={isResolving}
          className="active:scale-[0.97] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
        >
          {isResolving && (
            <Loader2 className="size-3 animate-[spin_0.7s_linear_infinite]" aria-hidden />
          )}
          Resolve market
        </Button>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolved stage — on-chain confirmed
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedProps {
  die: number
  record: DiceLocalRecord
  fromPriorSession: boolean
}

function ResolvedStage({ die, record, fromPriorSession }: ResolvedProps) {
  const reduce = useReducedMotion()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex flex-col items-center gap-5 px-6 py-10 text-center"
    >
      <motion.div
        initial={fromPriorSession ? { scale: 1 } : { scale: 0.6, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
        className="inline-flex items-center gap-2 border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300"
      >
        <Check className="size-3" aria-hidden />
        <span className="text-[10px] uppercase tracking-widest font-semibold">
          Resolved on-chain
        </span>
      </motion.div>

      <div className="relative">
        <DiceTumble result={die} size={148} />
        {!reduce && !fromPriorSession && (
          <CosmicConfetti key={`resolved-${die}`} fireKey={`resolved-${die}`} particleCount={14} />
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-4xl font-bold tabular-nums tracking-tight">
          {die}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          final · beacon #{record.targetSequence}
        </span>
      </div>

      <DiceShareCard
        result={die}
        commitmentId={record.commitmentId}
        targetSequence={record.targetSequence}
      />
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Not-found state
// ─────────────────────────────────────────────────────────────────────────────

function NotFoundView() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 border border-border bg-muted/10 px-6 py-10 text-center">
      <Sparkles className="size-6 text-muted-foreground/50" aria-hidden />
      <p className="text-sm text-foreground">Commitment not found</p>
      <p className="text-xs text-muted-foreground">
        This dice commitment isn't in this browser. Re-create the market or
        open the same browser you used to commit.
      </p>
      <Link
        to="/dice"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "active:scale-[0.97] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        )}
      >
        Back to dice list
      </Link>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Commitment exists locally but no on-chain market is linked yet.
// /reveal will reject every poll until that's done.
// ─────────────────────────────────────────────────────────────────────────────

function NoMarketLinkedView({ record }: { record: DiceLocalRecord }) {
  return (
    <PhaseSurface phase="awaiting">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-col items-center gap-5 px-6 py-10 text-center"
      >
        <div className="inline-flex items-center gap-2 border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-amber-300">
          <Link2Off className="size-3" aria-hidden />
          <span className="text-[10px] uppercase tracking-widest font-semibold">
            Market not on-chain
          </span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-2xl tabular-nums tracking-tight">
            #{record.commitmentId}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            commitment registered · awaiting market
          </span>
        </div>

        <p className="max-w-sm text-xs text-muted-foreground">
          Your cosmic commitment is ready, but the prediction market hasn't
          been deployed on-chain yet. Reveals are blocked until you create
          and link the market for beacon block{" "}
          <span className="font-mono text-foreground">
            #{record.targetSequence}
          </span>
          .
        </p>

        <Link
          to="/dice"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "active:scale-[0.97] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
          )}
        >
          Create the market
        </Link>
      </motion.div>
    </PhaseSurface>
  )
}
