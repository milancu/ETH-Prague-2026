import * as React from "react"

const SECRET = "kowalski"
const AUDIO_SRC = "/easter-eggs/kowalski-analysis.mp3"

/**
 * Listen for the user typing "kowalski" anywhere on the page; when matched,
 * play the analysis stinger and briefly toggle `triggered` so the UI can flash.
 */
export function useKowalskiEasterEgg() {
  const [triggered, setTriggered] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const bufferRef = React.useRef("")

  React.useEffect(() => {
    audioRef.current = new Audio(AUDIO_SRC)
    audioRef.current.preload = "auto"

    function onKeyDown(e: KeyboardEvent) {
      if (e.key.length !== 1) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }
      bufferRef.current = (bufferRef.current + e.key.toLowerCase()).slice(
        -SECRET.length,
      )
      if (bufferRef.current === SECRET) {
        bufferRef.current = ""
        const audio = audioRef.current
        if (audio) {
          audio.currentTime = 0
          void audio.play().catch(() => {})
        }
        setTriggered(true)
        window.setTimeout(() => setTriggered(false), 1800)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return triggered
}
