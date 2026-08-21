# spur serve

> Start the Spur web server (local fallback). Serves the task Kanban board and planning UI.
> The server is **Hono on Bun.serve** locally (or the Cloudflare Worker for production);
> static assets are served via Hono `serveStatic` (local) or the Cloudflare assets binding
> (production) with SPA fallback.
>
> **Canonical path:** `spur self serve`. The legacy `spur serve` top-level form remains a hidden
> alias over the same command — it keeps working unchanged for existing scripts and workflow YAML but
> is absent from `spur --help`.

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
| `--json` | — | Output `{ port, url, pid }` and exit (no server started) |

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

UI modules are auto-discovered at build time from `apps/web/src/modules/`. Adding a new board
module touches one directory and zero wiring — see
[How to Add a UI Module to the Spur Board](./how_to_add_a_new_ui_module.md).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port (overridden by `--port` when given) |
| `HOST` | `localhost` | Bind address (overridden by `--host` when given) |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.7 Serving
- [How to Add a UI Module](./how_to_add_a_new_ui_module.md) — the board module contract
- `docs/04_DESIGN.md` — §1.2 `spur serve` and `docs/design/server-side-adjustment-design.md`
