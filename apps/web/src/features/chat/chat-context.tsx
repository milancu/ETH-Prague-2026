import { createContext, useContext, type ReactNode } from "react"
import { useChat, type UseChatResult } from "./use-chat"

const ChatContext = createContext<UseChatResult | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChat()
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext(): UseChatResult {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("useChatContext must be used within <ChatProvider>")
  return ctx
}