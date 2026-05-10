import { useState } from "react"
import { useAccount } from "wagmi"
import { MessageSquare } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useComments, usePostComment } from "@/features/market/hooks/use-comments"
import type { CommentNode } from "@/features/market/api/comments"

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-400",
  "bg-emerald-500/15 text-emerald-400",
  "bg-amber-500/15 text-amber-400",
  "bg-purple-500/15 text-purple-400",
  "bg-rose-500/15 text-rose-400",
  "bg-cyan-500/15 text-cyan-400",
  "bg-orange-500/15 text-orange-400",
  "bg-teal-500/15 text-teal-400",
]

function addrColor(addr: string) {
  return AVATAR_COLORS[parseInt(addr.slice(2, 6), 16) % AVATAR_COLORS.length]
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function WalletAvatar({ address, className }: { address: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold leading-none",
        addrColor(address),
        className,
      )}
    >
      {address.slice(2, 4).toUpperCase()}
    </div>
  )
}

// ── Animation variants ────────────────────────────────────────────────────────

const listVariants = {
  visible: { transition: { staggerChildren: 0.055 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 7 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
  },
}

// ── Composer ──────────────────────────────────────────────────────────────────

function CommentComposer({
  marketId,
  parentId,
  onCancel,
  compact = false,
}: {
  marketId: string
  parentId?: number
  onCancel?: () => void
  compact?: boolean
}) {
  const { address, isConnected } = useAccount()
  const { mutate, isPending } = usePostComment(marketId)
  const [text, setText] = useState("")

  function submit() {
    if (!address || !text.trim()) return
    mutate(
      { author: address, content: text.trim(), parent_id: parentId ?? null },
      { onSuccess: () => { setText(""); onCancel?.() } },
    )
  }

  if (!isConnected) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Connect your wallet to comment.
      </p>
    )
  }

  const len = text.length
  const nearLimit = len > 1800
  const atLimit = len >= 2000

  return (
    <div className="flex items-start gap-3">
      {!compact && address && (
        <WalletAvatar address={address} className="size-7 mt-1" />
      )}
      <div className="flex flex-1 flex-col gap-2">
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={compact ? "Write a reply…" : "Write a comment…"}
          rows={compact ? 2 : 3}
          maxLength={2000}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={submit}
              disabled={isPending || !text.trim()}
            >
              {isPending ? "Posting…" : compact ? "Reply" : "Post"}
            </Button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
          {len > 0 && (
            <span
              className={cn(
                "text-[10px] tabular-nums transition-colors duration-200",
                atLimit
                  ? "text-destructive"
                  : nearLimit
                    ? "text-amber-400"
                    : "text-muted-foreground/60",
              )}
            >
              {len}/2000
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Comment item ──────────────────────────────────────────────────────────────

function CommentItem({
  comment,
  marketId,
  depth,
}: {
  comment: CommentNode
  marketId: string
  depth: number
}) {
  const [replying, setReplying] = useState(false)

  return (
    <motion.div variants={itemVariants}>
      <div className={cn("py-3", depth > 0 && "border-l border-border pl-4")}>
        <div className="flex gap-3">
          <WalletAvatar address={comment.author} className="size-6 mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{shortAddr(comment.author)}</span>
              <span aria-hidden>·</span>
              <time dateTime={comment.created_at}>{relativeTime(comment.created_at)}</time>
            </div>
            <p className="break-words text-sm leading-relaxed text-foreground/90">
              {comment.content}
            </p>
            <button
              onClick={() => setReplying(r => !r)}
              className={cn(
                "w-fit text-[11px] transition-colors duration-150",
                replying
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {replying ? "Cancel" : "Reply"}
            </button>

            <AnimatePresence>
              {replying && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                  style={{ overflow: "hidden" }}
                  className="mt-1"
                >
                  <CommentComposer
                    marketId={marketId}
                    parentId={comment.id}
                    onCancel={() => setReplying(false)}
                    compact
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {comment.replies.length > 0 && (
          <div className="mt-1 pl-9">
            <CommentThread
              comments={comment.replies}
              marketId={marketId}
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Thread (recursive) ────────────────────────────────────────────────────────

function CommentThread({
  comments,
  marketId,
  depth,
}: {
  comments: CommentNode[]
  marketId: string
  depth: number
}) {
  return (
    <div className="flex flex-col">
      {comments.map(c => (
        <CommentItem key={c.id} comment={c} marketId={marketId} depth={depth} />
      ))}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CommentsSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-1">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

export function CommentsSection({ marketId }: { marketId: string }) {
  const { data: comments = [], isLoading } = useComments(marketId)
  const total = countAll(comments)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-3.5 text-muted-foreground" aria-hidden />
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Comments
        </h2>
        <AnimatePresence mode="wait">
          {!isLoading && total > 0 && (
            <motion.span
              key={total}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="text-[10px] text-muted-foreground/70"
            >
              ({total})
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <CommentComposer marketId={marketId} />

      {!isLoading && comments.length > 0 && <Separator />}

      {isLoading ? (
        <CommentsSkeleton />
      ) : comments.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">
          No comments yet. Be the first!
        </p>
      ) : (
        <motion.div
          className="flex flex-col"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          {comments.map(c => (
            <CommentItem key={c.id} comment={c} marketId={marketId} depth={0} />
          ))}
        </motion.div>
      )}
    </section>
  )
}

function countAll(nodes: CommentNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countAll(n.replies), 0)
}