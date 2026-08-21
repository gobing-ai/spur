---
name: spur-cli-self
description: "spur-cli noun reference for `spur self`: self-management verbs — scaffold (`init`), schema migrations (`migrate`), local web server (`serve`), and status overview (`status`). Each verb mounts the same command builder as its legacy top-level noun, which remains a hidden alias over the identical command."
see_also:
  - spur-cli
---

# spur self - self-management verbs

`spur self` hosts the four self-management verbs. Each verb is the canonical path for a command
that also remains registered as a legacy top-level **hidden alias** (`spur init`, `spur migrate`,
`spur serve`, `spur status`) so existing scripts, workflow YAML, and habits keep working unchanged.
Both paths share the same command builder: identical flags, output, and exit codes. The legacy
top-level forms are omitted from `spur --help`, leaving `self` as the visible surface.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `init` | Scaffold a new Spur project in the current directory | `--name <name>` `--force` `--minimal` `--json` |
| `migrate` | Apply CLI-owned schema migrations | `--json` |
| `serve` | Start the Spur web server (local fallback) | `--port <n>` `--host <addr>` `--no-open` `--cwd <path>` `--json` |
| `status [path]` | Show project and git status for a Spur project | `--json` |

**Deep detail lives in the verb-owner references** — **[init.md](init.md)** owns the `init` and
`status` verbs (scaffold semantics + the Phase 1.5 / 1.6 post-scaffold validation probes),
**[serve.md](serve.md)** owns the `serve` verb (server flags and dry-probe semantics). `migrate`
has no reference of its own and is documented inline below.

## `self init` - scaffold a Spur project

```bash
spur self init                        # interactive: prompt for project name
spur self init --name my-project      # non-interactive
spur self init --name my-project --force  # overwrite existing .spur/ files
spur self init --minimal              # skip optional scaffolding (rules, workflows)
spur self init --json                 # machine-readable
```

Materializes the `.spur/` directory tree with config, docs, rules, and workflow templates. Flags:
`--name <name>` (default: current directory name), `--force` (recreate existing files), `--minimal`
(skip optional scaffolding), `--json` (machine-readable output). Post-scaffold validation probes
(Phase 1.5 / 1.6) run immediately after this verb completes — see **[init.md](init.md)** for the
probe protocol and rule-glob adaptation procedure.

## `self migrate` - apply CLI-owned schema migrations

```bash
spur self migrate                     # apply pending migrations
spur self migrate --json              # machine-readable { ok, applied }
```

Temporary helper: applies CLI-owned schema migrations and reports `{ ok, applied }`. Only flag is
`--json`.

## `self serve` - start the local web server

```bash
spur self serve                       # default: localhost:3000, opens browser
spur self serve --port 8080 --host 0.0.0.0
spur self serve --no-open             # skip browser
spur self serve --json                # dry probe: print { port, url, pid, running } and exit
```

Starts the Hono/Cloudflare-Worker server that serves the web Task Kanban and exposes the team
supervisor API (`/api/team/*`). It is the local fallback when no remote server is configured.
Flags: `--port <n>`, `--host <addr>`, `--no-open`, `--cwd <path>`, `--json` (a dry probe — reports
the resolved port/url without starting the server). Full flag semantics: **[serve.md](serve.md)**.

## `self status [path]` - project and git status

```bash
spur self status                      # current directory
spur self status /path/to/project     # specific project
spur self status --json               # machine-readable
```

Reports the project's Spur configuration state (init status, feature/task counts, rule preset
health) and git working-tree status. Optional `[path]` argument targets a different project
directory. Only flag is `--json`.

## What this skill is NOT

- **Not the team supervisor.** `self serve` hosts the supervisor API; `spur team start` / `stop` /
  `status` are the verbs that drive it. See **[team.md](team.md)**.
- **Not a production server.** This is the local fallback. Production deployment uses the Cloudflare
  Worker build (`apps/server/`), not `self serve`.

## See also

- **[init.md](init.md)** - `init` / `status` verbs: scaffold semantics and the Phase 1.5 / 1.6
  post-scaffold validation probes.
- **[serve.md](serve.md)** - `serve` verb: server flags and the `--json` dry-probe contract.
- **`spur team` (see [team.md](team.md))** - `start`/`stop`/`status` require `self serve` for the
  supervisor API.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
