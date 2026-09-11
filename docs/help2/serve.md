# spur serve

Start the Spur web server for the current project: the local UI for boards, runs, and team
status.

## Usage

```bash
spur serve [options]
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
spur serve                          # localhost:3000, opens the browser
spur serve --port 8080 --host 0.0.0.0
spur serve --no-open                # scripts and SSH sessions
spur serve --json                   # machine-readable { port, url, pid }, then exit
```

## What it serves

- **Web UI** — task kanban, workflow runs, history analytics, team status.
- **Supervisor API** — `spur team start/stop` and supervised agent loops require a reachable
  `spur serve`; without it, use `spur agent run --spec <id> --drain` for store-and-forward runs.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (same as `--port`) |
| `HOST` | Bind address (same as `--host`) |

## See also

- [team](./team.md) — supervised processes that need the server
- [projects](./projects.md) — the multi-project registry

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: serve.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
