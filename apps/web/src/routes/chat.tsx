import { useRef } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useChat } from "@/features/chat/use-chat"
import ChatComposer, {
  type ComposerHandle,
} from "@/features/chat/components/chat-composer"
import ChatEmpty from "@/features/chat/components/chat-empty"
import ChatThread from "@/features/chat/components/chat-thread"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

// 100dvh − header − footer − main padding (p-4 = 2rem total).
// Header and footer have explicit heights set via --header-h / --footer-h
// in __root.tsx, so this calc is precise.
const CHAT_HEIGHT = "calc(100dvh - var(--header-h) - var(--footer-h) - 2rem)"

function ChatPage() {
  const { messages, send, isPending, reset } = useChat()
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
      className="mx-auto flex w-full max-w-2xl flex-col border border-border bg-background"
      style={{ height: CHAT_HEIGHT }}
    >
      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          Kowalski
        </span>
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
      </div>

      {/* Thread — owns the scroll, fills available height */}
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

      {/* Composer — pinned bottom inside the panel */}
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