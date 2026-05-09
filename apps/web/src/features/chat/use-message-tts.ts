import { useCallback, useEffect, useRef, useState } from "react"
import { apiClient } from "@/utils/api-client"

export type TtsState = "idle" | "loading" | "playing" | "error"

interface UseMessageTtsResult {
  state: TtsState
  toggle: () => void
}

interface UseMessageTtsOptions {
  /** Auto-play once on first mount. Used for AI replies to voice input. */
  autoplay?: boolean
}

/**
 * Plays a single chat message via /v1/voice/tts. Caches the blob URL so
 * repeated plays don't re-bill the API.
 */
export function useMessageTts(
  text: string,
  options?: UseMessageTtsOptions,
): UseMessageTtsResult {
  const [state, setState] = useState<TtsState>("idle")
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const autoplayedRef = useRef(false)

  useEffect(() => {
    return () => {
      const audio = audioRef.current
      const url = blobUrlRef.current
      if (audio) {
        audio.pause()
        audio.src = ""
      }
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  const playFrom = useCallback((url: string) => {
    const audio = new Audio(url)
    audio.onended = () => setState("idle")
    audio.onerror = () => setState("idle")
    audioRef.current = audio
    setState("playing")
    void audio.play().catch(() => setState("idle"))
  }, [])

  const toggle = useCallback(async () => {
    if (state === "playing") {
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.currentTime = 0
      }
      setState("idle")
      return
    }
    if (state === "loading") return

    const cached = blobUrlRef.current
    if (cached) {
      playFrom(cached)
      return
    }

    setState("loading")
    try {
      const res = await apiClient.post(
        "/voice/tts",
        { text },
        { responseType: "blob" },
      )
      const url = URL.createObjectURL(res.data as Blob)
      blobUrlRef.current = url
      playFrom(url)
    } catch {
      setState("error")
      window.setTimeout(() => setState("idle"), 1500)
    }
  }, [state, text, playFrom])

  // Fire once on mount when autoplay is requested. Guard with a ref so
  // re-renders don't replay, and the second StrictMode pass is a no-op.
  useEffect(() => {
    if (!options?.autoplay) return
    if (autoplayedRef.current) return
    autoplayedRef.current = true
    void toggle()
    // toggle is stable enough — its closure captures state, but on a fresh
    // mount the state is "idle" so it'll fetch + play. Don't depend on it
    // here or we'd re-fire when state transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.autoplay])

  return { state, toggle }
}