---
name: spur-cli-serve
description: "spur-cli noun reference: operate `spur serve` as the local web-server fallback - start the Hono/Cloudflare-Worker server that backs the web Task Kanban and the team supervisor API. Single verb, five flags."
see_also:
  - spur-cli
---

# spur serve - local web server

`spur serve` starts the **Spur web server** - a local Hono / Cloudflare-Worker server that serves
the web Task Kanban and exposes the team supervisor API (`/api/team/*`). It is the local fallback
when no remote server is configured.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `serve` | Start the Spur web server (local fallback) | `--port <n>` `--host <addr>` `--no-open` `--cwd <path>` `--json` |

**Exit codes:** `0` success, `1` error.

## `serve` - start the web server

```bash
spur serve                          # default: localhost:3000, opens browser
spur serve --port 8080 --host 0.0.0.0
spur serve --no-open                # skip browser
spur serve --json                   # dry probe: print { port, url, pid, running } and exit
```

Starts the server with the Hono app backed by the local SQLite database. The web Task Kanban and
the team supervisor API become available at `http://<host>:<port>`.

### Flags

| Flag | Purpose |
|------|---------|
| `--port <n>` | Server port (env: `PORT`, default: `3000`). |
| `--host <addr>` | Bind address (env: `HOST`, default: `localhost`). |
| `--no-open` | Skip opening the browser (default: opens). |
| `--cwd <path>` | Working directory (default: current directory). |
| `--json` | Dry machine-readable probe: print `{ port, url, pid, running }` and exit. No server is started. |

`--json` is a **dry probe** - it reports the resolved port/url without starting the server
(`running: false`, `pid: null`). Use it to check what *would* start, not to launch.

## What this skill is NOT

- **Not the team supervisor.** `spur serve` hosts the supervisor API; `spur team start` / `stop` /
  `status` are the verbs that drive it. See **[team.md](team.md)**.
- **Not a production server.** This is the local fallback. Production deployment uses the Cloudflare
  Worker build (`apps/server/`), not `spur serve`.

## See also

- **`spur team` (see [team.md](team.md))** - `start`/`stop`/`status` require `spur serve` for the
  supervisor API.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.
