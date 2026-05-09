import { motion } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import type { ChatMessage } from "../schema"
import KowalskyMark from "./kowalsky-mark"
import MessageTtsButton from "./message-tts-button"
import TxCard from "./tx-card"

const EASE = [0.23, 1, 0.32, 1] as const

interface Props {
  message: ChatMessage
}

const ChatMessageView = ({ message }: Props) => {
  const isUser = message.role === "user"
  const canPlay = !isUser && message.content.trim().length > 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={cn(
        "flex w-full items-start gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && <KowalskyMark size="sm" />}
      <div
        className={cn(
          "flex min-w-0 max-w-[80%] flex-col gap-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "border px-3 py-1.5 text-sm leading-6",
            isUser
              ? "border-foreground/20 bg-muted/50"
              : "border-border bg-background",
          )}
        >
          <p className="whitespace-pre-wrap [&_p]:m-0 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:list-disc">
            {message.content}
          </p>
        </div>
        {canPlay && (
          <MessageTtsButton
            text={message.content}
            autoplay={message.autoSpeak}
            className="-mt-1"
          />
        )}
        {message.txCards?.map((card, i) => (
          <TxCard key={`${message.id}-tx-${i}`} card={card} />
        ))}
      </div>
    </motion.div>
  )
}

export default ChatMessageView