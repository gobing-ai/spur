# spur serve

> Start the Spur web server (local fallback). Serves the task Kanban board and planning UI.

## Usage

```
spur serve [options]
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--port <n>` | `3000` (env: `PORT`) | Server port |
| `--host <addr>` | `localhost` (env: `HOST`) | Bind address |
| `--no-open` | — | Skip opening the browser |
| `--cwd <path>` | Current directory | Working directory |
| `--json` | — | Output `{ port, url, pid }` and exit |

## Examples

```bash
spur serve                         # default: localhost:3000, opens browser
spur serve --port 8080             # custom port
spur serve --host 0.0.0.0          # bind to all interfaces
spur serve --no-open               # skip opening the browser
spur serve --json                  # output { port, url, pid } and exit (no server started)
```

## What It Serves

The web server provides:
- **Task Kanban board** — board, cards, detail panel, filters, polling, drag-and-drop
- **Feature tree** — hierarchical feature view with status badges
- **Planning UI** — task/feature management interface

The server uses Hono on Bun.serve (local) or Cloudflare Worker (production). Static assets are
served via Hono `serveStatic` (local) or Cloudflare assets binding (production) with SPA fallback.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `localhost` | Bind address |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.7 Serving
- `docs/04_DESIGN.md` — §serve surface
