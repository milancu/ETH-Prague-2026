import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

const MAX_LINES_PX = 168 // ~7 lines @ 24px line-height

interface Props {
  onSubmit: (text: string) => void
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

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setValue: (text) => {
      setValue(text)
      // Defer focus until value is in DOM so caret lands at end.
      requestAnimationFrame(() => {
        const el = taRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(text.length, text.length)
      })
    },
  }))

  // Autosize. Reset to auto first so shrinking works on backspace.
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES_PX)}px`
  }, [value])

  function submit() {
    const text = value.trim()
    if (!text || isPending) return
    onSubmit(text)
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

  return (
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
        disabled={isPending}
        className={cn(
          "flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none",
          "placeholder:text-muted-foreground/60",
          "disabled:opacity-60",
        )}
      />
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
  )
})

export default ChatComposer