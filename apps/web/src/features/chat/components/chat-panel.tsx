import { useRef } from "react"
import { Plus, X } from "lucide-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useChatContext } from "@/features/chat/chat-context"
import ChatComposer, {
  type ComposerHandle,
} from "@/features/chat/components/chat-composer"
import ChatEmpty from "@/features/chat/components/chat-empty"
import ChatThread from "@/features/chat/components/chat-thread"

type Variant = "page" | "sidebar"

interface Props {
  variant?: Variant
  onClose?: () => void
  className?: string
}

const ChatPanel = ({ variant = "page", onClose, className }: Props) => {
  const { messages, send, isPending, reset } = useChatContext()
  const composerRef = useRef<ComposerHandle>(null)
  const isEmpty = messages.length === 0

  function handleStarter(prompt: string) {
    composerRef.current?.setValue(prompt)
  }

  function handleNewChat() {
    reset()
    composerRef.current?.focus()
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col bg-background",
        variant === "page" && "border border-border",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          Kowalski
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNewChat}
            disabled={isEmpty || isPending}
            className={cn(
              "group inline-flex items-center gap-1.5 border border-border px-2 py-1",
              "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
              "transition-[transform,border-color,color] duration-150 ease-out",
              "active:scale-[0.97]",
              "hover:border-foreground hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-40",
              "disabled:hover:border-border disabled:hover:text-muted-foreground disabled:active:scale-100",
            )}
          >
            <Plus className="size-3" strokeWidth={2.5} />
            new chat
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Zavřít"
              className={cn(
                "inline-flex size-7 items-center justify-center border border-border text-muted-foreground",
                "transition-[transform,border-color,color] duration-150 ease-out",
                "hover:border-foreground hover:text-foreground active:scale-[0.94]",
              )}
            >
              <X className="size-3.5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "px-4 py-4",
            isEmpty && "flex min-h-full items-center justify-center",
          )}
        >
          {isEmpty ? (
            <ChatEmpty onPick={handleStarter} />
          ) : (
            <ChatThread messages={messages} isPending={isPending} />
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border bg-background p-3">
        <ChatComposer
          ref={composerRef}
          onSubmit={send}
          isPending={isPending}
        />
      </div>
    </div>
  )
}

export default ChatPanel
