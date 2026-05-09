import { createFileRoute } from "@tanstack/react-router"
import ChatPanel from "@/features/chat/components/chat-panel"

export const Route = createFileRoute("/chat")({
  component: ChatPage,
})

// 100dvh − header − footer − main padding (p-4 = 2rem total).
// Header and footer have explicit heights set via --header-h / --footer-h
// in __root.tsx, so this calc is precise.
const CHAT_HEIGHT = "calc(100dvh - var(--header-h) - var(--footer-h) - 2rem)"

function ChatPage() {
  return (
    <div className="mx-auto w-full max-w-2xl" style={{ height: CHAT_HEIGHT }}>
      <ChatPanel variant="page" />
    </div>
  )
}
