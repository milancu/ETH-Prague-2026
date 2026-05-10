// Drop the audio file at: apps/web/public/easter-eggs/<filename>.mp3
// Vite serves /public at the web root, so the URL is /easter-eggs/<filename>.mp3.
interface Egg {
  patterns: RegExp[]
  src: string
}

const EGGS: readonly Egg[] = [
  {
    // "Kowalski, analýza" — Penguins of Madagascar reference.
    // Lenient: kowalsk{i,y,eho,emu,ym,…} + analy{za,zy,sis,se,zuj,…}
    // Matches with/without comma, with/without diacritics, EN + CZ.
    patterns: [/\bkowalsk\w*[\s,]+analy(?:z|s)\w*\b/],
    src: "/easter-eggs/kowalski-analysis.mp3",
  },
]

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

let lastPlayedAt = 0

export function maybePlayEasterEgg(text: string): boolean {
  const norm = normalize(text)
  const egg = EGGS.find((e) => e.patterns.some((p) => p.test(norm)))
  if (!egg) return false

  // Debounce — avoid stacking if the user spam-submits.
  const now = Date.now()
  if (now - lastPlayedAt < 500) return true
  lastPlayedAt = now

  try {
    const audio = new Audio(egg.src)
    audio.volume = 0.9
    void audio.play().catch(() => {
      // Autoplay blocked or file missing — silently ignore.
    })
  } catch {
    /* noop */
  }
  return true
}
