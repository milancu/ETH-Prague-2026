# Cosmic Dice — SpaceComputer cTRNG

Provably-fair commit-reveal dice (1–6) using the SpaceComputer cTRNG beacon
(`/ipns/k2k4r8…09f`). Two front-ends, same algorithm:

- `index.html` — single-file browser app (no build step).
- `dice.py` — Python CLI (`commit` / `reveal`), stdlib only.

See [`spacecomputer.md`](./spacecomputer.md) for the bounty/integration context.

## Run locally

### Browser UI

```powershell
python serve.py            # http://localhost:5175
python serve.py 8080       # custom port
```

Or any other static server (`npx serve .`, VSCode Live Server, etc.).
The HTML calls the public `https://ipfs.io` gateway directly, so no backend
is required — but the host needs outbound HTTPS to `ipfs.io`.

### Python CLI

```powershell
python dice.py commit 5    # commit to a draw 5 minutes from now
python dice.py reveal      # after the target time, fetch + verify
```

Writes a `commitment.json` next to the script. No deps.

## Deploy to a server

The browser UI is fully static — served by nginx in a small container.

### Build & run via root docker-compose

```powershell
docker compose build cosmic-dice
docker compose up -d cosmic-dice
# → http://<server>:3003
```

The service is wired into the root [`docker-compose.yml`](../../docker-compose.yml).
Reverse-proxy a subdomain (`dice.kowalski-market.com` or similar) at port 3003
on the host. SPA fallback to `index.html` is configured in `nginx.conf`.

### Standalone (without compose)

```powershell
docker build -t cosmic-dice .
docker run --rm -p 3003:80 cosmic-dice
```

## Files

```
.
├── Dockerfile              # nginx:alpine, copies index.html in
├── nginx.conf              # SPA fallback
├── serve.py                # local dev server (stdlib http.server)
├── index.html              # the browser app
├── dice.py                 # Python CLI (commit/reveal)
├── spacecomputer.md        # bounty context / integration plan
└── README.md               # this file
```