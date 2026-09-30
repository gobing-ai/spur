# spur self serve

Start the Spur web server for the current project: the local UI for boards, runs, and team
status.

> **Canonical path:** `spur self serve`. The legacy `spur serve` top-level form remains a hidden alias.

## Usage

```bash
spur self serve [options]
```

## Options

| Flag | Description |
| --- | --- |
| `--port <n>` | Server port (env: `PORT`, default: 3000) |
| `--host <addr>` | Bind address (env: `HOST`, default: localhost) |
| `--no-open` | Skip opening the browser |
| `--cwd <path>` | Project root for server config and project-scoped work (default: the invocation directory) |
| `--json` | Output `{ port, url, pid }` and exit |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## Examples

```bash
spur self serve                          # localhost:3000, opens the browser
spur self serve --port 8080 --host 0.0.0.0
spur self serve --no-open                # scripts and SSH sessions
spur self serve --json                   # machine-readable { port, url, pid }, then exit
```

## What it serves

- **Web UI** — task kanban, workflow runs, history analytics, project fleet status.
- **Supervisor API** — `spur agent start/stop <spec-id>` and supervised agent loops require a reachable
  `spur self serve`; without it, use `spur agent run --spec <id> --drain` for store-and-forward runs.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (same as `--port`) |
| `HOST` | Bind address (same as `--host`) |

## See also

- [agent](./agent.md) — `agent start|stop` supervised processes that need the server
- [projects](./projects.md) — the multi-project registry

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: serve.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
