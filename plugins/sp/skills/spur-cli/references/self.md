---
name: spur-cli-self
description: "spur-cli noun reference for `spur self`: self-management verbs — SDLC action runner (`exec`), scaffold (`init`), machine setup (`install`, which installs the gateway LaunchAgent with `--daemon`), database maintenance (`maintain`), schema migrations (`migrate`), hybrid rg/zg search (`search`), local web server (`serve`), machine-artifact removal (`uninstall`) and status overview (`status`, which reports the LaunchAgent). The five legacy verbs (`init`, `maintain`, `migrate`, `serve`, `status`) each mount the same command builder as their legacy top-level noun, which remains a hidden alias; `exec` and `search` have no top-level alias."
see_also:
  - spur-cli
---

# spur self - self-management verbs

`spur self` hosts the self-management verbs. Five of them are the canonical path for a command
that also remains registered as a legacy top-level **hidden alias** (`spur self init`, `spur self maintain`, `spur self migrate`,
`spur self serve`, `spur self status`) so existing scripts, workflow YAML, and habits keep working unchanged.
Both paths share the same command builder: identical flags, output, and exit codes. The legacy
top-level forms are omitted from `spur --help`, leaving `self` as the visible surface.

`exec` is the exception: it exists only as `spur self exec` — there is no `spur exec` top-level
alias (`spur exec <action>` is an unknown command), so nothing depends on a legacy path. `search`
is the second such verb: `spur self search` only.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `exec` | Run (or list) a project SDLC action bound in `builder.actions` / `builder.preset` | `--list` `--dry-run` `--json` |
| `init` | Scaffold a new Spur project in the current directory | `--name <name>` `--force` `--minimal` `--adopt-global-config` `--json` |
| `install` | Converge machine-wide setup: global rules/config seeds, optional tools, and the gateway LaunchAgent with `--daemon` | `--with <zg\|a2a\|sp-plugin>` (repeatable) `--daemon` `--port <n>` `--json` `--json-envelope` |
| `maintain` | Run database maintenance: PRAGMA optimize, WAL truncation, optional VACUUM | `--vacuum` `--json` |
| `migrate` | Apply CLI-owned schema migrations (or `--check` the importer schema) | `--check` `--json` |
| `search` | Hybrid exact (`rg`) and semantic (`zg`) search over project docs and code | `--mode` `--scope` `--glob` `--limit` `--regex` `--status` `--json` |
| `serve` | Start the Spur web server (local fallback), or the one-port project gateway with `--gateway` | `--port <n>` `--host <addr>` `--gateway` `--no-open` `--cwd <path>` `--json` |
| `status [path]` | Show project, Git and machine readiness, plus the gateway LaunchAgent state | `--json` |
| `uninstall` | Remove the machine-level artifacts Spur installed (the gateway LaunchAgent) | `--daemon` `--port <n>` `--json` `--json-envelope` |

**Deep detail lives in the verb-owner references** — **[init.md](init.md)** owns the `init` and
`status` verbs (scaffold semantics + the Phase 1.5 / 1.6 post-scaffold validation probes),
**[serve.md](serve.md)** owns the `serve` verb (server flags and dry-probe semantics). `migrate`
has no reference of its own and is documented inline below.

## `self install --daemon` / `self uninstall` / `self status` - the project gateway LaunchAgent (macOS)

```
spur self install --daemon [--port <n>] [--json]
spur self uninstall [--daemon] [--port <n>] [--json]
spur self status [--json]        # daemon: { installed, loaded, pid, lastExit, health, plistPath }
```

The lifecycle is flat — no `daemon` sub-noun. `spur self install --daemon` installs (and
`spur self uninstall` removes) the user LaunchAgent `ai.gobing.spur.gateway`
(`~/Library/LaunchAgents/`) that runs `spur self serve --gateway` with `RunAtLoad`, `KeepAlive`,
`AbandonProcessGroup`, `ThrottleInterval 10`, the captured `PATH` and logs under
`~/Library/Logs/spur/`. `install` is idempotent (`unchanged` when the bytes match) and refuses a
non-macOS platform or a port held by another process **without writing anything**; `status` reports
installed/loaded/pid/last-exit plus `GET /api/health`; `uninstall` boots the agent out and removes the
plist (absent = success, exit 0). `spur self status` embeds the same report under `daemon` and
renders a one-line `Daemon:` summary. There is no `spur self daemon <action>` spelling: it was
removed in task 1387 and now fails as an unknown command, so write `install --daemon`,
`uninstall` or `status`.

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
| `1` | unknown option (commander usage error, before the verb runs) |

`--list --json` rows are `{ name, reserved, source: config|preset|default|unbound, command | steps }`; an
`unbound` row carries neither `command` nor `steps`, so branch on `source`;
`--dry-run --json` prints `[{ name, command }]`, one object per resolved step, and runs nothing.
`--json` without `--list` or `--dry-run` prints a final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }`
after the streaming output. Full surface: `docs/design/sdlc-actions.md` §3.3.

## `self search` - hybrid exact and semantic search

```bash
spur self search "how is a paused workflow resumed"       # auto: exact + fuzzy where available
spur self search Bun.which --mode exact                   # ripgrep only
spur self search 'runCost' --mode fuzzy --limit 5         # zg semantic only
spur self search resum --mode exact --scope docs --glob '*.md'
spur self search --status                                 # backend readiness, no query
spur self search Bun.which --mode exact --json            # raw SearchResponse payload
```

One verb over the hybrid search service (`docs/design/hybrid-search.md` §4, ADR-147). `--mode` is
`exact` | `fuzzy` | `auto` (default `auto`), `--scope` is `docs` | `code` | `all` (default `all`),
`--limit` is 1–100 (default 20), `--glob` adds a backend glob (repeatable; prefix `!` to negate),
and `--regex` switches the exact route from fixed string to pattern. `--status` prints the `rg`/`zg`
readiness payload and takes no query.

The groups are `exact` (ripgrep `--json` events) and `fuzzy` (zg `--hybrid`); a group is `null` when
that route did not run, and `skipped[]` names the degraded route with its reason
(`zg-not-installed`, `zg-index-missing`, `zg-timeout`, `zg-failed`, `zg-output-error`) plus an exact
hint string. Hints are printed, never executed — Spur installs and indexes nothing. Human output
prints `exact (n)` / `fuzzy (n)` headers with `path:start[-end]  [matchedBy]` rows, the first three
snippet lines indented, then the skip lines; zero hits print `no matches`. `--json` emits the
`SearchResponse` verbatim (`--json-envelope` for the ADR-091 envelope).

| Exit | When |
| ---- | ---- |
| `0` | results, empty results, or a degraded fuzzy route |
| `1` | invalid request (empty query, bad mode/scope/limit), rg missing or rg failed |
| `2` | no query and no `--status` (usage) |

Raw zg/rg passthrough flags are deliberately absent: they would leak the adapter.

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

## `self install [--with <tool>]...` - machine setup

```bash
spur self install                          # converge machine seeds, report optional tools
spur self install --with zg                # also install the zg hybrid-search CLI
spur self install --with zg --with a2a     # repeatable; one flag per tool
spur self install --json                   # machine-readable report
```

Owns the machine layer only: it copies the shipped global rules and config into the machine config
root (`SPUR_GLOBAL_RULES_DIR` when set, else `~/.config/spur`), never overwriting an existing file,
and reports the optional tools (`zg`, `a2a`, `sp-plugin`) it did not touch. `--with <tool>` is what
performs network or package-manager work; a tool already on PATH reports `unchanged` and nothing is
installed. `sp-plugin` delegates to `superskill install sp --marketplace <dir>` — Superskill owns
adapter state, so this verb never copies adapters itself.

It never scaffolds the current directory (`spur self init`), migrates SQL (`spur self migrate`),
edits a shell profile, or replaces a running binary (`scripts/install.sh` acquires the first
binary). Unknown `--with` values exit 2 before any write. The report is
`{ok, changed, steps: [{name, state, required, message}]}` with state
`created` / `unchanged` / `skipped` / `failed`; exit 0 when every required and every explicitly
selected step succeeded, 1 otherwise (the verified binary stays installed, and a rerun retries only
the unfinished steps).

## `self status [path]` - consolidated read-only readiness

```bash
spur self status                      # current directory
spur self status /path/to/project     # specific project
spur self status --json               # machine-readable
```

Reports project scaffold health, git working-tree status, and DecisionMaker readiness (0911) as
before — the human output keeps its `Project:`/`Package:`/`Agents:`/`Git:`/`DecisionMaker:` lines
and `--json` keeps `ok`, `packageJson`, `spurConfig`, `git`, `agentSpecs` and `decisionMaker:
{enabled, provider, credentialPresent, state, connectivity, inlineSupport}`. Presence check only —
never a live probe, never echoes the key.

Since A93 it also adds `schemaVersion: 1`, `overallState: ready|degraded|missing`, and nine
`sections` — `installation`, `configuration`, `schema`, `dependencies`, `projects`, `agents`,
`decisions`, `corpus`, `workflows` — each `{state, scope, source, message, data?}` with state
`ready` / `degraded` / `missing` / `unavailable` / `not-applicable` / `error` and scope
`machine` / `project`. The aggregate is read-only: it never opens or migrates the project database
(ledger sections report `unavailable` with the reason), never installs a tool, never starts a
server, and shares one 5000 ms budget across its async probes. Exit status stays project-scaffold
health: 0 when the project config exists, 1 when it is missing, unreadable, or the optional `[path]`
argument fails. Optional `[path]` targets a file/dir to describe. Flags: `--json`,
`--json-envelope`.

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
