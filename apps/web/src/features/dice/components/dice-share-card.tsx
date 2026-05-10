import { useState } from "react"
import { motion } from "motion/react"
import { Check, Copy } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

interface Props {
  result: number
  commitmentId: number
  targetSequence: number
  className?: string
}

/**
 * Compact share artifact for a revealed cosmic roll. Two actions:
 * — Post on X (intent URL, no auth required)
 * — Copy link (current page)
 */
export function DiceShareCard({
  result,
  commitmentId,
  targetSequence,
  className,
}: Props) {
  const [copied, setCopied] = useState(false)

  const shareText = `🎲 Cosmic dice rolled a ${result} — derived from beacon block #${targetSequence}. Verifiable, unpredictable, on-chain.`
  const shareUrl =
    typeof window !== "undefined" ? window.location.href : ""

  const xHref = `https://x.com/intent/post?text=${encodeURIComponent(
    shareText,
  )}&url=${encodeURIComponent(shareUrl)}`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — silent */
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1], delay: 0.15 }}
      className={cn(
        "flex items-center gap-2 text-[11px]",
        className,
      )}
    >
      <span className="uppercase tracking-widest text-muted-foreground/70">
        Share
      </span>
      <a
        href={xHref}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1",
          "transition-all duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
          "hover:border-foreground/40 hover:bg-foreground/[0.03]",
          "active:scale-[0.97]",
        )}
        aria-label="Post on X"
      >
        <XLogo className="size-3" />
        Post
      </a>
      <Button
        variant="outline"
        size="sm"
        className="h-auto gap-1.5 px-2.5 py-1 text-[11px] active:scale-[0.97] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
        onClick={onCopy}
        aria-label="Copy link"
      >
        {copied ? (
          <>
            <Check className="size-3 text-emerald-400" aria-hidden />
            Copied
          </>
        ) : (
          <>
            <Copy className="size-3" aria-hidden />
            Copy link
          </>
        )}
      </Button>
      <span className="font-mono text-muted-foreground/50">
        #{commitmentId}
      </span>
    </motion.div>
  )
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
