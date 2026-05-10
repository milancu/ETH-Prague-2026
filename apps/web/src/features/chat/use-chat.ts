import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useAccount, useChainId } from "wagmi"
import { toast } from "sonner"
import { apiClient } from "@/utils/api-client"
import {
  ChatResponseSchema,
  type ChatMessage,
  type ChatResponse,
} from "./schema"
import { maybePlayEasterEgg } from "./easter-eggs"

const STORAGE_KEY = "kowalsky.chat.v1"
const MAX_HISTORY = 50
// /markets/16 → 16. Anything else → null.
const MARKET_PATH_RE = /^\/markets\/(\d+)\b/

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
  /** Append a hidden tool_result user message and re-call /v1/chat. Used by
   *  the intelligence_request flow after a successful x402 payment. */
  submitToolResult: (toolName: string, data: unknown) => void
  /** Current market_id derived from URL — stable so children can pin it
   *  without subscribing to the location themselves. */
  currentMarketId: number | null
  isPending: boolean
  reset: () => void
}

export function useChat(): UseChatResult {
  // Lazy init — sessionStorage is read once, not on every render.
  const [messages, setMessages] = useState<ChatMessage[]>(loadInitial)
  const { address } = useAccount()
  const chainId = useChainId()
  // Subscribe only to pathname; the rest of location churns on every nav.
  const pathname = useLocation({ select: (l) => l.pathname })
  const match = pathname.match(MARKET_PATH_RE)
  const currentMarketId = match ? Number(match[1]) : null
  // Read from a ref inside mutationFn so we don't recreate the mutation.
  const marketIdRef = useRef(currentMarketId)
  marketIdRef.current = currentMarketId
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
        // Latest pathname at request time — read via ref so the mutation
        // identity stays stable across navigation.
        market_id: marketIdRef.current,
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
          intelligenceRequest: data.intelligence_request ?? undefined,
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
      maybePlayEasterEgg(trimmed)
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

  const submitToolResult = useCallback(
    (toolName: string, data: unknown) => {
      // System prompt rule 9: messages of the form `[tool_result <name>]: <json>`
      // are treated as authoritative tool output, not as user input. Sent as
      // role:user because that is the only role the BE accepts beyond `assistant`.
      pendingOriginRef.current = "text"
      const payload = `[tool_result ${toolName}]: ${JSON.stringify(data)}`
      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: payload,
      }
      let history: ChatMessage[] = []
      setMessages((prev) => {
        // Clear the now-fulfilled intelligenceRequest from the latest assistant
        // message so its card disappears once we relay the result.
        const cleared = prev.map((m, i) =>
          i === prev.length - 1 && m.intelligenceRequest
            ? { ...m, intelligenceRequest: undefined }
            : m,
        )
        history = [...cleared, userMsg]
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
    submitToolResult,
    currentMarketId,
    isPending: mutation.isPending,
    reset,
  }
}
