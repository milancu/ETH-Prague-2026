import { useCallback, useEffect, useRef, useState } from "react"
import { apiClient } from "@/utils/api-client"

export type RecorderState =
  | "idle"
  | "recording"
  | "processing"
  | "success"
  | "error"

interface UseVoiceRecorderOptions {
  onTranscript: (text: string) => void
  onError?: (message: string) => void
  /** Auto-stop after this many ms of silence following detected speech.
   *  Default 1200. */
  silenceMs?: number
  /** Hard cap on a single recording. Default 30000. */
  maxDurationMs?: number
}

interface UseVoiceRecorderResult {
  state: RecorderState
  /** Start if idle, stop+transcribe if recording. */
  toggle: () => void
  /** Stop and discard. No transcription, no onTranscript. */
  cancel: () => void
  /** Live mic level, 0..1. Driven by an AnalyserNode RMS. */
  levelRef: React.MutableRefObject<number>
  /** True after we've detected the user actually started speaking. */
  hasSpokenRef: React.MutableRefObject<boolean>
}

// Pick the first MIME type the browser actually supports. Order matters —
// webm/opus is the most universal, mp4 is Safari's default.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

// Speech onset / silence thresholds tuned for typical laptop mics with
// echoCancel + autoGain. Values are RMS over [0, 1].
const SPEECH_ON = 0.05
const SPEECH_OFF = 0.025

export function useVoiceRecorder({
  onTranscript,
  onError,
  silenceMs = 1200,
  maxDurationMs = 30000,
}: UseVoiceRecorderOptions): UseVoiceRecorderResult {
  const [state, setState] = useState<RecorderState>("idle")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // VAD plumbing
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelRef = useRef(0)
  const hasSpokenRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const recordingStartRef = useRef<number>(0)
  const cancelRef = useRef(false)

  const teardownAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch {
        /* noop */
      }
      analyserRef.current = null
    }
    const ctx = audioCtxRef.current
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => {})
    }
    audioCtxRef.current = null
    levelRef.current = 0
    hasSpokenRef.current = false
    silenceStartRef.current = null
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // Always release the mic on unmount.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop()
      } catch {
        /* noop */
      }
      teardownAudio()
      stopStream()
    }
  }, [stopStream, teardownAudio])

  const stopRecorder = useCallback(() => {
    const r = recorderRef.current
    if (r && r.state !== "inactive") {
      try {
        r.stop()
      } catch {
        /* noop */
      }
    }
    recorderRef.current = null
  }, [])

  const start = useCallback(async () => {
    cancelRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      )
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        teardownAudio()
        stopStream()

        // Cancelled paths: drop the buffer, return to idle silently.
        if (cancelRef.current) {
          chunksRef.current = []
          cancelRef.current = false
          setState("idle")
          return
        }

        const blob = new Blob(chunksRef.current, {
          type: mimeType ?? "audio/webm",
        })
        chunksRef.current = []

        if (blob.size === 0) {
          setState("idle")
          return
        }

        setState("processing")
        try {
          const ext = (mimeType ?? "audio/webm").includes("mp4")
            ? "mp4"
            : "webm"
          const form = new FormData()
          form.append("file", blob, `recording.${ext}`)
          // Czech UI — bias the model. The user can still speak any language;
          // Scribe v2 falls back to detection if confidence is low.
          form.append("language_code", "ces")

          const res = await apiClient.post<{ text: string }>(
            "/voice/stt",
            form,
            { headers: { "Content-Type": "multipart/form-data" } },
          )
          const text = (res.data.text ?? "").trim()
          if (!text) {
            setState("error")
            onError?.("Nepodařilo se rozpoznat řeč.")
            return
          }
          setState("success")
          onTranscript(text)
        } catch (err) {
          setState("error")
          const msg =
            err instanceof Error ? err.message : "Přepis se nezdařil."
          onError?.(msg)
        }
      }

      // Audio analysis on the same stream — no second getUserMedia.
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const ctx = new AudioCtx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.6
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      const buf = new Uint8Array(analyser.fftSize)
      const tick = () => {
        const a = analyserRef.current
        if (!a) return
        a.getByteTimeDomainData(buf)
        // RMS over [-1, 1] mapped from byte time-domain.
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        levelRef.current = rms

        const now = performance.now()
        if (rms >= SPEECH_ON) {
          hasSpokenRef.current = true
          silenceStartRef.current = null
        } else if (rms < SPEECH_OFF && hasSpokenRef.current) {
          if (silenceStartRef.current === null) silenceStartRef.current = now
          else if (now - silenceStartRef.current >= silenceMs) {
            // Silence threshold reached — auto-finalize.
            stopRecorder()
            return
          }
        }

        // Hard cap.
        if (now - recordingStartRef.current >= maxDurationMs) {
          stopRecorder()
          return
        }

        rafRef.current = requestAnimationFrame(tick)
      }

      recordingStartRef.current = performance.now()
      hasSpokenRef.current = false
      silenceStartRef.current = null

      recorder.start()
      recorderRef.current = recorder
      setState("recording")
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      teardownAudio()
      stopStream()
      setState("error")
      const msg =
        err instanceof Error ? err.message : "Mikrofon není dostupný."
      onError?.(msg)
    }
  }, [
    onTranscript,
    onError,
    stopStream,
    teardownAudio,
    stopRecorder,
    silenceMs,
    maxDurationMs,
  ])

  const toggle = useCallback(() => {
    if (state === "recording") stopRecorder()
    else if (state === "idle" || state === "error" || state === "success") {
      void start()
    }
  }, [state, start, stopRecorder])

  const cancel = useCallback(() => {
    cancelRef.current = true
    stopRecorder()
  }, [stopRecorder])

  return { state, toggle, cancel, levelRef, hasSpokenRef }
}
