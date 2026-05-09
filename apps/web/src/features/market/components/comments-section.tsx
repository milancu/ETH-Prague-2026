import { useState } from "react"
import { useAccount } from "wagmi"
import { MessageSquare } from "lucide-react"
import { useComments, usePostComment } from "@/features/market/hooks/use-comments"
import type { CommentNode } from "@/features/market/api/comments"

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ── Composer ──────────────────────────────────────────────────────────────────

function CommentComposer({
  marketId,
  parentId,
  onCancel,
}: {
  marketId: string
  parentId?: number
  onCancel?: () => void
}) {
  const { address, isConnected } = useAccount()
  const { mutate, isPending } = usePostComment(marketId)
  const [text, setText] = useState("")

  function submit() {
    if (!address || !text.trim()) return
    mutate(
      { author: address, content: text.trim(), parent_id: parentId ?? null },
      {
        onSuccess: () => {
          setText("")
          onCancel?.()
        },
      },
    )
  }

  if (!isConnected) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Connect your wallet to comment.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Write a comment…"
        rows={3}
        maxLength={2000}
        className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={isPending || !text.trim()}
          className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? "Posting…" : "Post"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

// ── Single comment ────────────────────────────────────────────────────────────

function CommentItem({ comment, marketId, depth }: { comment: CommentNode; marketId: string; depth: number }) {
  const [replying, setReplying] = useState(false)

  return (
    <div className={depth > 0 ? "border-l border-border pl-4" : ""}>
      <div className="flex flex-col gap-1.5 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{shortAddr(comment.author)}</span>
          <span>·</span>
          <span>{relativeTime(comment.created_at)}</span>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{comment.content}</p>
        <button
          onClick={() => setReplying(r => !r)}
          className="w-fit text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Reply
        </button>
        {replying && (
          <div className="mt-1">
            <CommentComposer
              marketId={marketId}
              parentId={comment.id}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}
      </div>
      {comment.replies.length > 0 && (
        <CommentThread comments={comment.replies} marketId={marketId} depth={depth + 1} />
      )}
    </div>
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

// ── Section ───────────────────────────────────────────────────────────────────

export function CommentsSection({ marketId }: { marketId: string }) {
  const { data: comments = [], isLoading } = useComments(marketId)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <MessageSquare className="size-3.5" aria-hidden />
        Comments {!isLoading && `(${countAll(comments)})`}
      </h2>

      <CommentComposer marketId={marketId} />

      {isLoading ? (
        <div className="flex flex-col gap-3 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">No comments yet. Be the first!</p>
      ) : (
        <CommentThread comments={comments} marketId={marketId} depth={0} />
      )}
    </section>
  )
}

function countAll(nodes: CommentNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countAll(n.replies), 0)
}
