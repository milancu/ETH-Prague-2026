import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { ArrowUp, Mic } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@workspace/ui/lib/utils"
import VoiceOverlay from "@/components/voice/voice-overlay"
import { useVoiceRecorder } from "@/features/chat/use-voice-recorder"
import type { SendOrigin } from "@/features/chat/use-chat"

const MAX_LINES_PX = 168 // ~7 lines @ 24px line-height

interface Props {
  onSubmit: (text: string, opts?: { origin?: SendOrigin }) => void
  isPending: boolean
  placeholder?: string
}

export interface ComposerHandle {
  focus: () => void
  setValue: (text: string) => void
}

const ChatComposer = forwardRef<ComposerHandle, Props>(function ChatComposer(
  { onSubmit, isPending, placeholder = "Zeptej se Kowalského…" },
  ref,
) {
  const [value, setValue] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)

  const recorder = useVoiceRecorder({
    onTranscript: (text) => {
      // Voice path: tag origin so the assistant reply auto-plays via TTS.
      onSubmit(text, { origin: "voice" })
      setValue("")
    },
    onError: (msg) => toast.error(msg),
  })

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setValue: (text) => {
      setValue(text)
      requestAnimationFrame(() => {
        const el = taRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(text.length, text.length)
      })
    },
  }))

  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES_PX)}px`
  }, [value])

  function submit() {
    const text = value.trim()
    if (!text || isPending) return
    onSubmit(text, { origin: "text" })
    setValue("")
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  const canSend = value.trim().length > 0 && !isPending
  // The overlay is the recording UI now. Show it during record + processing
  // so the user sees "Přepisuji…" before the message lands.
  const overlayOpen =
    recorder.state === "recording" || recorder.state === "processing"

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className={cn(
          "relative flex items-end gap-2 border border-border bg-background p-2",
          "focus-within:border-foreground/60",
          "transition-colors duration-150 ease-out",
        )}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isPending || overlayOpen}
          className={cn(
            "flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none",
            "placeholder:text-muted-foreground/60",
            "disabled:opacity-60",
          )}
        />

        <button
          type="button"
          onClick={recorder.toggle}
          disabled={isPending}
          aria-label="Nahrát hlasovou zprávu"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center border border-border bg-background",
            "text-muted-foreground transition-[transform,border-color,color] duration-150 ease-out",
            "hover:border-foreground hover:text-foreground active:scale-[0.94]",
            "disabled:cursor-not-allowed disabled:active:scale-100",
          )}
        >
          <Mic className="size-4" strokeWidth={2.25} />
        </button>

        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center border",
            "transition-[transform,background-color,color] duration-150 ease-out",
            "active:scale-[0.94]",
            canSend
              ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
              : "border-border bg-background text-muted-foreground/50",
            "disabled:cursor-not-allowed disabled:active:scale-100",
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </form>

      <VoiceOverlay
        open={overlayOpen}
        state={recorder.state}
        hasSpokenRef={recorder.hasSpokenRef}
        levelRef={recorder.levelRef}
        onCancel={recorder.cancel}
      />
    </>
  )
})

export default ChatComposer
