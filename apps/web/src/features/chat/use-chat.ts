import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useAccount, useChainId } from "wagmi"
import { toast } from "sonner"
import { apiClient } from "@/utils/api-client"
import {
  ChatResponseSchema,
  type ChatMessage,
  type ChatResponse,
} from "./schema"

const STORAGE_KEY = "kowalsky.chat.v1"
const MAX_HISTORY = 50

function loadInitial(): ChatMessage[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as ChatMessage[]
  } catch {
    return []
  }
}

export type SendOrigin = "text" | "voice"

function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export interface UseChatResult {
  messages: ChatMessage[]
  send: (content: string, opts?: { origin?: SendOrigin }) => void
  isPending: boolean
  reset: () => void
}

export function useChat(): UseChatResult {
  // Lazy init — sessionStorage is read once, not on every render.
  const [messages, setMessages] = useState<ChatMessage[]>(loadInitial)
  const { address } = useAccount()
  const chainId = useChainId()
  // Origin of the in-flight send. Read in onSuccess to flag the assistant
  // reply for auto-TTS without round-tripping through state.
  const pendingOriginRef = useRef<SendOrigin>("text")

  // Persist to sessionStorage. Cap at MAX_HISTORY so storage doesn't bloat.
  // Strip transient flags (autoSpeak) so they don't replay on reload.
  useEffect(() => {
    try {
      const persistable = messages.slice(-MAX_HISTORY).map((m) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { autoSpeak, ...rest } = m
        return rest
      })
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persistable))
    } catch {
      // Quota exceeded or disabled — silently drop.
    }
  }, [messages])

  const mutation = useMutation({
    mutationFn: async (history: ChatMessage[]): Promise<ChatResponse> => {
      const res = await apiClient.post("/chat", {
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        user_address: address ?? null,
        // BE scopes reads + TxCard calldata to this chain.
        chain_id: chainId ?? null,
      })
      return ChatResponseSchema.parse(res.data)
    },
    onSuccess: (data) => {
      const autoSpeak = pendingOriginRef.current === "voice"
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: data.text,
          txCards: data.tx_cards.length ? data.tx_cards : undefined,
          autoSpeak: autoSpeak || undefined,
        },
      ])
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message.split("\n")[0] : "Chat failed"
      toast.error(message)
    },
  })

  // Side effects must NOT live inside the setState callback — React 19
  // StrictMode double-invokes updaters and would fire `mutate` twice.
  const { mutate } = mutation
  const send = useCallback(
    (content: string, opts?: { origin?: SendOrigin }) => {
      const trimmed = content.trim()
      if (!trimmed) return
      pendingOriginRef.current = opts?.origin ?? "text"
      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
      }
      let history: ChatMessage[] = []
      setMessages((prev) => {
        history = [...prev, userMsg]
        return history
      })
      mutate(history)
    },
    [mutate],
  )

  const reset = useCallback(() => {
    setMessages([])
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* noop */
    }
  }, [])

  return {
    messages,
    send,
    isPending: mutation.isPending,
    reset,
  }
}