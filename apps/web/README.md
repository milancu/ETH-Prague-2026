# apps/web

Frontend (Vite + React + TypeScript). Uses shadcn/ui via the shared `@workspace/ui` package.

## Adding shadcn components

Run from the repo root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components land in `packages/ui/src/components/`.

## Using components

```tsx
import { Button } from "@workspace/ui/components/button";
```
