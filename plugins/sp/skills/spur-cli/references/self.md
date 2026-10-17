---
name: spur-cli-self
description: "spur-cli noun reference for `spur self`: self-management verbs — SDLC action runner (`exec`), scaffold (`init`), database maintenance (`maintain`), schema migrations (`migrate`), local web server (`serve`), and status overview (`status`). The five legacy verbs (`init`, `maintain`, `migrate`, `serve`, `status`) each mount the same command builder as their legacy top-level noun, which remains a hidden alias; `exec` has no top-level alias."
see_also:
  - spur-cli
---

# spur self - self-management verbs

`spur self` hosts the self-management verbs. Five of them are the canonical path for a command
that also remains registered as a legacy top-level **hidden alias** (`spur init`, `spur maintain`, `spur migrate`,
`spur serve`, `spur status`) so existing scripts, workflow YAML, and habits keep working unchanged.
Both paths share the same command builder: identical flags, output, and exit codes. The legacy
top-level forms are omitted from `spur --help`, leaving `self` as the visible surface.

`exec` is the exception: it exists only as `spur self exec` — there is no `spur exec` top-level
alias (`spur exec <action>` is an unknown command), so nothing depends on a legacy path.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `exec` | Run (or list) a project SDLC action bound in `builder.actions` / `builder.preset` | `--list` `--dry-run` `--json` |
| `init` | Scaffold a new Spur project in the current directory | `--name <name>` `--force` `--minimal` `--adopt-global-config` `--json` |
| `maintain` | Run database maintenance: PRAGMA optimize, WAL truncation, optional VACUUM | `--vacuum` `--json` |
| `migrate` | Apply CLI-owned schema migrations (or `--check` the importer schema) | `--check` `--json` |
| `serve` | Start the Spur web server (local fallback) | `--port <n>` `--host <addr>` `--no-open` `--cwd <path>` `--json` |
| `status [path]` | Show project and git status for a Spur project | `--json` |

**Deep detail lives in the verb-owner references** — **[init.md](init.md)** owns the `init` and
`status` verbs (scaffold semantics + the Phase 1.5 / 1.6 post-scaffold validation probes),
**[serve.md](serve.md)** owns the `serve` verb (server flags and dry-probe semantics). `migrate`
has no reference of its own and is documented inline below.

## `self exec` - run a project SDLC action

```bash
spur self exec build                   # run the resolved command in the project root
spur self exec lint -- --fix           # extra args: shell-quoted and appended to a string action
spur self exec --list                  # every reserved + declared action, its source and command
spur self exec --list --json           # machine-readable action inventory
spur self exec test --dry-run          # print the resolved command(s), run nothing
spur self exec check -- --fail-on error  # trailing args reach the command (composites refuse them: exit 2)
```

Runs one action resolved from the project's `builder` config in `.spur/config.yaml`:
`builder.actions.<action>` first, then the active `builder.preset` (`bun` or `none`), then the
stack-neutral default. The command runs through `sh -c` **in the project root** with
stdout/stderr inherited (stdin is not forwarded) and `SPUR_ACTION=<action>` exported to the child;
spur exits with the child's exit code.
A composite action runs its steps in order, echoes `▶ <step>` per step on stderr, and stops at the
first non-zero exit.

| Exit | When |
| ---- | ---- |
| child's code | the action (or the failing composite step) exited non-zero |
| `2` | action unbound, composite given arguments, or no action and no `--list` |

`--list --json` rows are `{ name, reserved, source: config|preset|default|unbound, command | steps }`;
`--dry-run --json` prints `[{ name, command }]`, one object per resolved step, and runs nothing.
`--json` without `--list` prints a final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }`
after the streaming output. Full surface: `docs/design/sdlc-actions.md` §3.3.

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
(skip optional scaffolding), `--adopt-global-config` (also rewrite `~/.config/spur/config.yaml` from
the shipped global default, backed up first), `--json` (machine-readable output). Post-scaffold validation probes
(Phase 1.5 / 1.6) run immediately after this verb completes — see **[init.md](init.md)** for the
probe protocol and rule-glob adaptation procedure.

## `self maintain` - run database maintenance

```bash
spur self maintain                    # run PRAGMA optimize + wal_checkpoint(TRUNCATE)
spur self maintain --vacuum           # deep maintenance: VACUUM + optimize + checkpoint
spur self maintain --json             # machine-readable
```

Executes SQLite database maintenance operations on `.spur/spur.db`:
- `PRAGMA optimize;` to refresh query planner statistics in `sqlite_stat1`.
- `PRAGMA wal_checkpoint(TRUNCATE);` to checkpoint committed WAL frames and truncate WAL to 0 bytes.
- `--vacuum` runs `VACUUM;` first for page compaction and B-tree defragmentation (requires 2x free disk space).

## `self migrate` - apply CLI-owned schema migrations

```bash
spur self migrate                     # apply pending migrations
spur self migrate --json              # machine-readable { ok, applied }
spur self migrate --check             # read-only importer-schema drift report (exit 1 on drift)
```

Temporary helper: applies CLI-owned schema migrations and reports `{ ok, applied }`. Flags are
`--json` and `--check`; with `--check` the command only reports importer schema drift, leaves an
absent database absent, and never repairs.

## `self serve` - start the local web server

```bash
spur self serve                       # default: localhost:3000, opens browser
spur self serve --port 8080 --host 0.0.0.0
spur self serve --no-open             # skip browser
spur self serve --json                # dry probe: print { port, url, pid, running } and exit
```

Starts the Hono/Cloudflare-Worker server that serves the web Task Kanban and exposes the team
supervisor API (`/api/processes/*` + `/api/agents/*`). It is the local fallback when no remote server is configured.
Flags: `--port <n>`, `--host <addr>`, `--no-open`, `--cwd <path>`, `--json` (a dry probe — reports
the resolved port/url without starting the server). Full flag semantics: **[serve.md](serve.md)**.

## `self status [path]` - project and git status

```bash
spur self status                      # current directory
spur self status /path/to/project     # specific project
spur self status --json               # machine-readable
```

Reports the project's Spur configuration state (init status, feature/task counts, rule preset
health), git working-tree status, and DecisionMaker readiness (0911): the human output adds a
`DecisionMaker:` line and `--json` exposes `decisionMaker: {enabled, provider,
credentialPresent, state, connectivity, inlineSupport}` with states `disabled` / `missing-key` /
`configured-not-probed`. Presence check only — never a live probe, never echoes the key.
Optional `[path]` argument targets a different project
directory. Only flag is `--json`.

## What this skill is NOT

- **Not the agent supervisor.** `self serve` hosts the supervisor API; `spur agent start` / `stop` /
  `agent list --specs` are the verbs that drive and inspect it (0848). See
  **[agent.md](agent.md)**.
- **Not a production server.** This is the local fallback. Production deployment uses the Cloudflare
  Worker build (`apps/server/`), not `self serve`.

## See also

- **[init.md](init.md)** - `init` / `status` verbs: scaffold semantics and the Phase 1.5 / 1.6
  post-scaffold validation probes.
- **[serve.md](serve.md)** - `serve` verb: server flags and the `--json` dry-probe contract.
- **`spur agent` (see [agent.md](agent.md))** - `start`/`stop`/`list --specs` require `self serve`
  for the supervisor API.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
