import { useEffect, useRef } from "react"
import { motion } from "motion/react"
import type { ChatMessage } from "../schema"
import ChatMessageView from "./chat-message"
import KowalskyMark from "./kowalsky-mark"
import ThinkingDots from "./thinking-dots"

const EASE = [0.23, 1, 0.32, 1] as const

interface Props {
  messages: ChatMessage[]
  isPending: boolean
}

const ChatThread = ({ messages, isPending }: Props) => {
  const endRef = useRef<HTMLDivElement>(null)

  // Autoscroll to bottom on new message or thinking-state change.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, isPending])

  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => (
        <ChatMessageView key={m.id} message={m} />
      ))}
      {isPending && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="flex items-center gap-3"
        >
          <KowalskyMark size="sm" />
          <ThinkingDots />
        </motion.div>
      )}
      <div ref={endRef} aria-hidden />
    </div>
  )
}

export default ChatThread