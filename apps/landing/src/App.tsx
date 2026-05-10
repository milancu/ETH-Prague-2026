import { Button } from "@workspace/ui/components/button"
import { ArrowUpRight, Gavel, Mic, MapPin } from "lucide-react"
import logo from "./assets/logo.svg"
import { HighlightText } from "@/components/animate-ui/primitives/texts/highlight.tsx"
import { useKowalskiEasterEgg } from "./hooks/use-kowalski-easter-egg"

const APP_URL = "https://app.kowalski-market.com"

const SHOTS = [
  {
    n: "01",
    label: "Markets index",
    title: "Browse the long tail.",
    body: "Trending Czech politics, weather, sport beyond the top leagues — everything legacy books skip.",
    src: "/markets-overview.png",
    span: "lg:col-span-7",
  },
  {
    n: "02",
    label: "Market detail",
    title: "Live book. Honest chart.",
    body: "Probability over time, last trades, and a side-by-side ticket. No paywalls, no fake odds.",
    src: "/market-detail.png",
    span: "lg:col-span-5",
  },
  {
    n: "03",
    label: "Kowalsky chat",
    title: "Talk to the protocol.",
    body: "Ask, analyze, prepare a trade — Kowalsky drafts a transaction card; you sign it. The agent never holds keys.",
    src: "/kowalsky-chat.png",
    span: "lg:col-span-5",
  },
  {
    n: "04",
    label: "Create market",
    title: "Anyone proposes. Curators gate.",
    body: "Question, resolution rules, expiry, outcome type. Post a 50 TAB anti-spam bond and ship it.",
    src: "/create-market.png",
    span: "lg:col-span-7",
  },
] as const

const FEATURES = [
  {
    n: "01",
    label: "Permissionless markets",
    title: "Anyone can deploy any market with their own rules.",
    body: "User defines the question, outcomes, expiry, and resolution source and posts a bond; a curator gates it for clarity and duplicates before it goes live, with the bond slashed on bad-faith markets. Spam costs money — the long tail stays open.",
    icon: Gavel,
  },
  {
    n: "02",
    label: "Voice + text AI layer",
    title: "Trade through a voice- and text-controlled AI.",
    body: "Kowalsky is a voice- and text-driven layer over the protocol. You can trade, navigate the app, ask and discuss markets, and set limits and orders — all by speaking or typing. The user always signs the final transaction; the agent never holds keys.",
    icon: Mic,
  },
  {
    n: "03",
    label: "Central Europe first",
    title: "Bet on what Central Europe bookmakers won't list.",
    body: "CE politics, weather, energy prices, sport beyond the top leagues, pop culture — the long tail that legacy fixed-odds traditional markets ignore.",
    icon: MapPin,
  },
] as const

export default function App() {
  const eggTriggered = useKowalskiEasterEgg()
  return (
    <div className="min-h-dvh bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
      <Topbar />
      <Hero />
      <Features />
      <Showcase />
      <ClosingCta />
      <Footer />
      <KowalskiFlash active={eggTriggered} />
    </div>
  )
}

function KowalskiFlash({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-foreground/5 backdrop-blur-[1px]" />
      <p
        className={`relative font-['Instrument_Serif',ui-serif,serif] text-[clamp(3rem,12vw,11rem)] leading-none tracking-[-0.02em] transition-transform duration-500 ${
          active ? "scale-100" : "scale-95"
        }`}
      >
        Kowalski,{" "}
        <em className="text-muted-foreground/70">analysis.</em>
      </p>
    </div>
  )
}

function Topbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="flex shrink-0 items-center" aria-label="Kowalski Market">
          <img src={logo} alt="" className="h-7 w-auto" />
        </a>

        <div className="flex items-center gap-3 sm:gap-4">
          <span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:flex">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative size-1.5 rounded-full bg-emerald-500" />
            </span>
            Live · Base Sepolia
          </span>
          <Button render={<a href={APP_URL} />} size="sm" className="rounded-none">
            Open app
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative border-b border-border">
      {/* Hairline grid accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mx-auto hidden max-w-7xl px-4 sm:block sm:px-6"
      >
        <div className="grid h-full grid-cols-12 gap-0">
          {Array.from({ length: 13 }).map((_, i) => (
            <div
              key={i}
              className="border-l border-border/40 first:border-l last:border-r"
            />
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-32 lg:pt-32 lg:pb-40">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-9">
            <p className="animate-in font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase duration-500 ease-out fill-mode-both [animation-delay:50ms] fade-in slide-in-from-bottom-1">
              Manifesto · Issue 01 · 2026
            </p>
            <h1 className="mt-6 animate-in font-['Instrument_Serif',ui-serif,serif] text-[clamp(2.5rem,7.5vw,8.5rem)] leading-[0.94] font-normal tracking-[-0.02em] text-balance duration-700 ease-out fill-mode-both [animation-delay:120ms] fade-in slide-in-from-bottom-2">
              We built a prediction market with{" "}
              <HighlightText
                text="three key"
                inView
                inViewMargin="-20%"
                transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
                style={{
                  backgroundImage:
                    "linear-gradient(oklch(0.705 0.213 47.604 / 0.5), oklch(0.705 0.213 47.604 / 0.5))",
                  paddingInline: "0.1em",
                  marginInline: "-0.1em",
                }}
              />{" "}
              <HighlightText
                text="unique features"
                inView
                inViewMargin="-20%"
                delay={350}
                transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
                style={{
                  backgroundImage:
                    "linear-gradient(oklch(0.705 0.213 47.604 / 0.5), oklch(0.705 0.213 47.604 / 0.5))",
                  paddingInline: "0.1em",
                  marginInline: "-0.1em",
                }}
              />{" "}
              <em className="text-muted-foreground/70">
                that nobody else has.
              </em>
            </h1>
          </div>

          <div className="flex flex-col gap-8 lg:col-span-3 lg:pt-3">
            <div className="animate-in duration-500 ease-out fill-mode-both [animation-delay:240ms] fade-in slide-in-from-bottom-1">
              <p className="font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase">
                The deck
              </p>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-balance text-muted-foreground">
                Open market creation, a voice- and text-controlled AI layer for
                market analysis, creation, and betting — with{" "}
                <span className="text-foreground">Central-Europe-first</span>{" "}
                coverage.
              </p>
            </div>

            <div className="flex animate-in flex-wrap items-center gap-2 duration-500 ease-out fill-mode-both [animation-delay:340ms] fade-in slide-in-from-bottom-1">
              <Button
                render={<a href={APP_URL} />}
                size="default"
                className="rounded-none"
              >
                Try the app
                <ArrowUpRight data-icon="inline-end" />
              </Button>
              <Button
                render={<a href="#features" />}
                size="default"
                variant="outline"
                className="rounded-none"
              >
                Read the case
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-heading">
      <h2 id="features-heading" className="sr-only">
        Three unique features
      </h2>
      {FEATURES.map((f) => (
        <FeatureRow key={f.n} feature={f} />
      ))}
    </section>
  )
}

function FeatureRow({ feature }: { feature: (typeof FEATURES)[number] }) {
  const Icon = feature.icon
  return (
    <article className="group border-b border-border transition-colors duration-300 hover:bg-muted/30">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-12 lg:gap-12 lg:py-20">
        <div className="flex items-end gap-5 lg:col-span-3">
          <span
            aria-hidden
            className="font-['Instrument_Serif',ui-serif,serif] text-7xl leading-[0.85] tracking-tight text-muted-foreground/35 transition-colors duration-300 group-hover:text-foreground sm:text-8xl"
          >
            {feature.n}
          </span>
          <span className="hidden h-12 w-px bg-border lg:block" />
          <Icon
            aria-hidden
            className="mb-2 size-5 text-muted-foreground transition-colors duration-300 group-hover:text-foreground"
            strokeWidth={1.5}
          />
        </div>

        <div className="lg:col-span-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {feature.label}
          </p>
          <h3 className="mt-3 text-balance font-['Instrument_Serif',ui-serif,serif] text-3xl font-normal leading-[1.05] tracking-[-0.01em] sm:text-4xl lg:text-[2.75rem]">
            {feature.title}
          </h3>
        </div>

        <div className="lg:col-span-4 lg:pt-2">
          <p className="text-pretty text-[15px] leading-relaxed text-muted-foreground">
            {feature.body}
          </p>
        </div>
      </div>
    </article>
  )
}

function Showcase() {
  return (
    <section
      id="showcase"
      aria-labelledby="showcase-heading"
      className="border-b border-border"
    >
      <div className="mx-auto max-w-7xl px-4 pt-20 pb-6 sm:px-6 sm:pt-28">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          Plate · Shots from the floor
        </p>
        <h2
          id="showcase-heading"
          className="mt-4 max-w-3xl text-balance font-['Instrument_Serif',ui-serif,serif] text-4xl leading-[1.02] tracking-[-0.01em] sm:text-6xl"
        >
          Four screens, <em className="text-muted-foreground/70">one protocol.</em>
        </h2>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
          {SHOTS.map((s) => (
            <ShotCard key={s.n} shot={s} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ShotCard({ shot }: { shot: (typeof SHOTS)[number] }) {
  return (
    <figure
      className={`group flex flex-col gap-4 ${shot.span ?? "lg:col-span-6"}`}
    >
      <div className="relative overflow-hidden border border-border bg-muted/30">
        <img
          src={shot.src}
          alt={shot.title}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full transition-transform duration-700 ease-out group-hover:scale-[1.015]"
        />
      </div>
      <figcaption className="flex items-baseline gap-4">
        <span
          aria-hidden
          className="font-['Instrument_Serif',ui-serif,serif] text-3xl leading-none text-muted-foreground/40"
        >
          {shot.n}
        </span>
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            {shot.label}
          </p>
          <p className="mt-1 text-balance font-['Instrument_Serif',ui-serif,serif] text-2xl leading-[1.1] tracking-[-0.01em]">
            {shot.title}
          </p>
          <p className="mt-2 text-pretty text-[14px] leading-relaxed text-muted-foreground">
            {shot.body}
          </p>
        </div>
      </figcaption>
    </figure>
  )
}

function ClosingCta() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-20 sm:px-6 sm:py-28 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-3xl text-balance font-['Instrument_Serif',ui-serif,serif] text-4xl leading-[1.02] tracking-[-0.01em] sm:text-6xl lg:text-7xl">
          The long tail of{" "}
          <em className="text-muted-foreground/70">what could happen</em> —
          finally tradable.
        </p>
        <Button
          render={<a href={APP_URL} />}
          size="lg"
          className="shrink-0 rounded-none"
        >
          Open the app
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>© 2026 Kowalski Market · Penguins × Claude</span>
        <span className="hidden sm:inline">
          Type <kbd className="px-1 text-foreground">kowalski</kbd> for a second opinion
        </span>
        <a
          href="https://api.kowalski-market.com/v1/integrations"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground"
        >
          Developers ↗
        </a>
      </div>
    </footer>
  )
}
