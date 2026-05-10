import { Loader2, Square, Volume2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { useMessageTts } from "../use-message-tts"

interface Props {
  text: string
  className?: string
  /** Auto-play once on mount. Set when this message came from a voice query. */
  autoplay?: boolean
}

const MessageTtsButton = ({ text, className, autoplay }: Props) => {
  const { state, toggle } = useMessageTts(text, { autoplay })

  const isPlaying = state === "playing"
  const isLoading = state === "loading"

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        isPlaying ? "Zastavit přehrávání" : "Přehrát zprávu nahlas"
      }
      disabled={isLoading}
      className={cn(
        "inline-flex size-6 items-center justify-center border border-border bg-background",
        "text-muted-foreground transition-[transform,color,border-color] duration-150 ease-out",
        "hover:border-foreground hover:text-foreground active:scale-[0.94]",
        "disabled:cursor-wait disabled:active:scale-100",
        isPlaying && "border-foreground text-foreground",
        className,
      )}
    >
      {isLoading ? (
        <Loader2 className="size-3 animate-spin" strokeWidth={2.25} />
      ) : isPlaying ? (
        <Square className="size-2.5" strokeWidth={3} fill="currentColor" />
      ) : (
        <Volume2 className="size-3" strokeWidth={2.25} />
      )}
    </button>
  )
}

export default MessageTtsButton