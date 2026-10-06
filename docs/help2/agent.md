# spur agent

Run and inspect supported coding agents. This is Spur's **single LLM execution surface** — every
model call in Spur (skills, workflow `agent.run` actions, team-mode runs) routes through
`spur agent run`. Spur owns no other path to a model.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents (agent specs with `--specs`) |
| `report` | Report a fleet member lifecycle state (`working`/`idle`/`blocked`) from a host hook |
| `join` / `leave` | Join or leave the fleet as a guest occupant (a live session that pulls its own work) |
| `doctor [agent]` | Check agent readiness |
| `status` | Show agent specs with live process status and member session (requires `spur self serve`) |
| `usage` | Run-once provider usage capture that refreshes quota-owned executor availability |
| `wait [specId]` | Wait for a pinned occupant run to reach a lifecycle state (`--inbox <id>` waits for a guest's queued work instead) |
| `start <spec-id>` | Start a supervised agent process (requires `spur self serve`) |
| `stop <spec-id>` | Stop a supervised agent process (requires `spur self serve`) |

## spur agent run

```bash
spur agent run [options] <prompt>
```

| Flag | Description |
| --- | --- |
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline` (host-session; on headless surfaces a role/tier fallback resolves with one warning) |
| `--spec <id>` | Team agent spec id (occupant addressing; pairs with `--drain`) |
| `--continue` | Resume the previous agent session |
| `--model <name>` | Agent model argument |
| `--mode <mode>` | Agent output mode: `text` \| `json` |
| `--cwd <path>` | Working directory for agent execution |
| `--drain` | Prepend pending inbox messages for `--spec <id>` |
| `--json` | Output machine-readable JSON |

`--agent` resolves in this order: explicit value (role → configured executor → bare binary with a
one-time warning) → `auto` via the `agent` config block (default) → static detection fallback. An
explicit `--model` always wins over the executor's configured model.

Exit codes: `0` success · `1` agent not found or unusable · `2` invalid arguments · `3` execution
failure.

```bash
spur agent run "Add a login endpoint to src/auth/"
spur agent run "Fix the failing test" --agent codex
spur agent run "Continue" --continue
spur agent run "Run the tests" --cwd ./packages/domain
spur agent run "Work on task 0010" --spec reviewer --drain
```

> **Team mode:** `--drain` folds the addressed spec's pending inbox messages into the prompt and
> dispatches with the spec's executor. That is how deferred messages reach a subprocess run,
> which has no live stdin.

## spur agent list

```bash
spur agent list [--specs] [--server <url>] [--json]
```

Without flags: detected coding agents. With `--specs`: team agent specs from `.spur/agents/`;
`--server` points at the server API for live run status (default: this project's registry serve port,
`http://localhost:<port>/api`; `http://localhost:3000/api` only when the project has no live entry).

## spur agent report

```bash
spur agent report [options]
```

| Flag | Description |
| --- | --- |
| `--state <state>` | Lifecycle state: `working`, `idle`, or `blocked` (required) |
| `--seq <ns>` | Monotonic report sequence in nanoseconds; not greater than the last accepted one → ignored (required) |
| `--spec <id>` | Member spec id (defaults to `SPUR_SPEC_ID`) |
| `--json` | Output machine-readable JSON |

An accepted report writes the `agent.lifecycle.changed` ledger row that is the member's current
state: the dispatch strategy treats `blocked` as unavailable, and the Board shows `needs human`.
Exit `2` when a required flag is missing or malformed, or when no member id resolves. The `sp`
plugin's host hooks call this in the background; outside a fleet they make no call.

## spur agent join

```bash
spur agent join --role <name> [--id <id>] [--session-id <sid>] [--pid <n>] [--executor <name>]
```

| Flag | Description |
| --- | --- |
| `--role <name>` | Layer-1 role the guest occupies (`scribe` \| `coder` \| `reviewer` \| `planner`) |
| `--id <id>` | Guest id (defaults to `<role>-g<n>`); a collision with a declared member or a joined guest exits 2 |
| `--session-id <sid>` | Host session id (defaults to `CLAUDE_CODE_SESSION_ID`) — the Stop hook matches on it |
| `--pid <n>` | Process id to record |
| `--executor <name>` | Executor name to record (informational; a guest is never dispatched to) |
| `--json` | Output machine-readable JSON |

## spur agent leave

```bash
spur agent leave [id] [--session-id <sid>]
```

| Flag | Description |
| --- | --- |
| `[id]` | Guest id (defaults to the guest joined by this host session) |
| `--session-id <sid>` | Host session id (defaults to `CLAUDE_CODE_SESSION_ID`) |
| `--json` | Output machine-readable JSON |

A guest is a session that **pulls** work: never supervised, never restarted, addressable by concrete
id only. `join` writes an occupant row, claims a `guest:<id>` lease and records
`.spur/run/guests/<id>.json`; `leave` (or lease expiry) releases the lease, marks the occupant
exited, returns its claimed messages to `pending` and removes the record.

## spur agent status

```bash
spur agent status [--server <url>] [--json]
```

Agent specs with live process status and member session, read from the running server.

## spur agent usage

```bash
spur agent usage [--dry-run] [--source <source>] [--json]
```

Run-once provider usage capture (default source `codexbar`) that refreshes quota-owned executor
availability. Schedule it externally (cron/launchd) — `spur self serve` never runs it. `--dry-run`
prints the would-be changes without writing the snapshot or any config.

## spur agent doctor

```bash
spur agent doctor [agent] [--probe-health] [--force-refresh] [--json]
```

Readiness check (installed, authenticated, usable). Detection results are cached —
`--force-refresh` bypasses the cache and `--probe-health` opts into live model probing.

## spur agent trace

```bash
spur agent trace <runId> [--follow] [--timeout <ms>] [--json]
```

Print one execution record as a lineage: the run, the runs that dispatched it and the runs it
dispatched, each with its status, the agent session ids recorded for it and its durable stream under
`.spur/memory/runs/<runId>.md`. `--follow` polls until every run in the lineage is terminal and prints
one checkpoint line before exiting 1 on timeout.

## spur agent wait

```bash
spur agent wait [specId] [--role <name>] [--run <runId>] [--until <state>] [--timeout <ms>] [--json]
```

Block until a pinned occupant run reaches a lifecycle state. Address the occupant by spec id
**or** `--role` (mutually exclusive); pin a specific run with `--run`, otherwise the spec's
latest run is used. `--until` is repeatable (OR semantics) and `--timeout` bounds the wait in
milliseconds.

## spur agent start / stop

```bash
spur agent start <spec-id> [--server <url>] [--json]
spur agent stop <spec-id> [--server <url>] [--json]
```

Start or stop a supervised agent process through the running server.

## Agent specs

`.spur/agents/<id>.yaml` specs are materialized from the fleet declaration when `spur self serve`
starts; there is no CLI verb to hand-author them. `spur agent loop` is supervisor-internal
(hidden from `--help`): the supervisor spawns one per started spec.

## See also

- [Daily development workflow](./daily-development-workflow.md) — where agent execution fits
- [message](./message.md) — multi-agent coordination around specs

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: agent.txt + verbs/agent_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
