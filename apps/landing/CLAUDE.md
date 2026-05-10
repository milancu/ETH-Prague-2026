# apps/landing — CLAUDE.md

Marketingový landing page (jednostránkový), nasazený na samostatnou subdoménu. Read root [`CLAUDE.md`](../../CLAUDE.md) first.

## Stack

- Vite + React 19 + TypeScript.
- Tailwind v4 via `@tailwindcss/vite`.
- Sdílené styly + shadcn primitivy z `@workspace/ui` (stejný design jako `apps/web`).
- **Bez** wagmi/viem/RainbowKit, bez routeru. Pokud potřebuješ web3 funkci, patří do `apps/web`.

## Pravidla

- Žádné nové top-level deps bez justifikace v PR — landing musí zůstat lehký (LCP, SEO).
- Sdílené komponenty přidávej do `packages/ui`, ne sem. Tady jsou jen page-level sekce specifické pro landing.
- Mobile-first, stejné Tailwind konvence jako `apps/web`.
- Pro nové shadcn primitivy použij CLI v `packages/ui` (nikdy je negeneruj přímo sem).

## Dev

```
pnpm --filter landing dev      # http://localhost:5174
pnpm --filter landing build
```

## Nasazení

Server (Docker, primární cesta):

```
docker compose build landing
docker compose up -d landing            # http://server:3002
```

Build context je root repa, `Dockerfile` v `apps/landing/`. Statické `dist/` je servováno nginxem; SPA fallback na `index.html` je v `nginx.conf`. Compose namapuje kontejnerový port 80 → host 3002. Reverse proxy (Caddy/nginx/Traefik) potom rozliší subdoménu.

Alternativa Vercel: nový projekt napojený na stejné repo, `Root Directory: apps/landing`, `Build Command: pnpm --filter landing build`, `Output Directory: dist`.
