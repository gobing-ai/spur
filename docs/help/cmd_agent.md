# spur agent

> Run and inspect supported coding agents. **This is Spur's single LLM execution surface** —
> every model call in Spur (sp skills, workflow `agent.run` actions, team-mode runs) routes
> through `spur agent run`. Spur owns no other path to a model (it is not a BYOK LLM
> platform — ADR/PRD).

## Subcommands

| Subcommand | Description |
|---|---|
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents; with `--specs`, list agent specs |
| `report` | Report a fleet member lifecycle state (`working`/`idle`/`blocked`) from a host hook |
| `join` / `leave` | Join or leave the fleet as a guest occupant (a live session that pulls its own work) |
| `doctor [agent]` | Check agent readiness (usable, authenticated, version) |
| `wait <specId>` | Identity-pinned wait for an occupant run to reach a lifecycle state |
| `loop` | Supervisor-internal self-draining loop for an agent spec (hidden from `--help`) |
| `start <spec-id>` | Start a supervised agent process (requires `spur self serve`) |
| `stop <spec-id>` | Stop a supervised agent process (requires `spur self serve`) |

## spur agent run

```
spur agent run [options] <prompt>
```

| Flag | Description |
|---|---|
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline`. A **role** (`scribe`/`coder`/`reviewer`/`planner`) selects the starting tier; an **executor** pins a configured profile; a bare binary name works with a one-time warning; `auto` (default) resolves via the `agent` config block. Explicit `inline` requests host-session execution; on headless surfaces (this command is headless) a role/tier fallback resolves with one warning (ADR-087 — substitution over rejection; the G5 exit-2 rejection is retired). `spur agent run` always starts a subprocess. |
| `--spec <id>` | Team agent spec id (occupant addressing); pairs with `--drain` |
| `--continue` | Resume the previous agent session |
| `--model <name>` | Agent model argument (explicit `--model` wins over the configured one) |
| `--mode <mode>` | Agent output mode: `text` \| `json` (default: `text`) |
| `--cwd <path>` | Working directory for agent execution |
| `--drain` | Prepend pending inbox messages for the `--spec <id>` occupant |
| `--json` | Output machine-readable envelope |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Agent-not-found (or known-but-unusable per phase config) |
| 2 | Invalid arguments (unknown selector; explicit `inline` on this headless surface) |
| 3 | Agent execution failure |

### `--agent` resolution

`--agent` (default `auto`) resolves via the `agent` config block. The value-semantics contract
(`inline` / `auto` / `<name>` and the one rule, value table, executor precedence chain) is the
SSOT in
[cross-cutting.md](../../plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
The resolution steps below are specific to `spur agent run` (the subprocess surface):

1. An explicit `--agent` value wins: **role** first (the closed Layer-1 vocabulary), then
   configured **executor**, then a bare coding-agent binary (one-time shim warning). Unknown
   values are rejected with exit 2 at the flag boundary, before any process spawns.
2. Omitted / `auto` resolves `agent.default` as the **default role** (recommended `coder`; a
   configured executor name still resolves during the transition with a one-time warning), and
   the stage registry's `model_policy` starts on the cheapest eligible executor at that tier.
3. On miss, the static Tier-1 priority resolver picks the first usable Tier-1 agent — the
   legacy behavior preserved when no `agent` config is present.
4. An explicit `--model` always wins over the resolved executor's configured model.

(Phase-based routing is retired: `default-by-phase` was removed in task 0452 and prompt-regex
phase detection in 0536 R4.)

### `--drain` (team mode)

`--drain` resolves the addressed `--spec <id>` as an **agent spec id** (a different namespace
from the coding-agent type; a legacy `--agent <spec-id>` still works during the transition with a
one-time warning), folds that spec's pending inbox messages into the prompt, and
rewrites the selector to the spec's executor before dispatch. Phase 1-3 has no live stdin,
so prepending is how deferred messages reach the agent.

### Examples

```bash
spur agent run "Add a login endpoint to src/auth/"
spur agent run "Fix the failing test" --agent codex
spur agent run "Continue" --continue
spur agent run "Refactor the DB layer" --agent gemini --model gemini-2.0-flash
spur agent run "Summarize the diff" --agent grok
spur agent run "Generate a summary" --mode json --json
spur agent run "Run the tests" --cwd ./packages/domain
spur agent run "Work on task 0089" --agent reviewer --drain
```

### JSON shape

`--json` emits a machine-readable envelope:

```json
{
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 1234
}
```

## spur agent usage

```
spur agent usage [options]
```

| Flag | Description |
|---|---|
| `--dry-run` | Print would-be changes; write neither the snapshot nor any config |
| `--source <source>` | Usage source implementation |
| `--json` | Output machine-readable JSON |

Run-once provider usage capture (codexbar) that refreshes quota-owned executor
availability. Schedule it externally (cron/launchd); `spur self serve` never runs it.
Healthy providers whose windows are exhausted disable their executors (owner
`quota`); recovered headroom re-enables them. Providers matching no configured
executor are listed as unmapped, never guessed. A missing or failing codexbar
run is fail-closed: nothing is written and the command exits non-zero.

## spur agent report

```
spur agent report [options]
```

Reports a fleet member's lifecycle state, so the dispatch strategy knows the member is
unavailable while it waits on a human, and the Board can show `needs human` on it. The `sp`
plugin's host hooks call it in the background whenever `SPUR_SPEC_ID` is set; outside a fleet
they make no call at all.

| Flag | Description |
|---|---|
| `--state <state>` | Lifecycle state: `working`, `idle`, or `blocked` (required) |
| `--seq <ns>` | Monotonic report sequence in nanoseconds; a value not greater than the last accepted one is ignored (required) |
| `--spec <id>` | Member spec id (defaults to `SPUR_SPEC_ID`) |
| `--json` | Output machine-readable JSON |

Exit `2` when `--state`/`--seq` is missing or malformed, or when no member id resolves (set
`SPUR_SPEC_ID` or pass `--spec`). An accepted report writes the `agent.lifecycle.changed`
ledger row; a stale report is ignored and prints `ignored stale report`.

## spur agent join

```
spur agent join --role <name> [--id <id>] [--session-id <sid>] [--pid <n>] [--executor <name>]
```

A **guest occupant** is a live interactive session that joins the fleet to pull work instead of
being driven by it: it is never supervised, never restarted, and never a stage target.

| Flag | Description |
|---|---|
| `--role <name>` | Layer-1 role the guest occupies (`scribe` \| `coder` \| `reviewer` \| `planner`) |
| `--id <id>` | Guest id (defaults to `<role>-g<n>`); a collision with a declared member or a joined guest exits 2 |
| `--session-id <sid>` | Host session id (defaults to `CLAUDE_CODE_SESSION_ID`); the Stop hook matches on it |
| `--pid <n>` | Process id to record (defaults to this process) |
| `--executor <name>` | Executor name to record (informational — a guest is never dispatched to) |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap the JSON in the standard output envelope |

`join` writes an occupant row in `coordination_runs`, claims a `guest:<id>` lease, and writes
`.spur/run/guests/<id>.json`.

## spur agent leave

```
spur agent leave [id] [--session-id <sid>]
```

| Flag | Description |
|---|---|
| `[id]` | Guest id (defaults to the guest joined by this host session) |
| `--session-id <sid>` | Host session id (defaults to `CLAUDE_CODE_SESSION_ID`) |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap the JSON in the standard output envelope |

`leave` (or lease expiry) releases the lease, marks the occupant exited, returns its claimed
messages to `pending`, and removes the record. Exit `2` on an unknown role, an id collision, or
`leave` without an id when this host session never joined.

## spur agent status

```
spur agent status [options]
```

| Flag | Description |
|---|---|
| `--server <url>` | Supervisor API URL for live run status and member session (default: this project's registry serve port, `http://localhost:<port>/api`; `http://localhost:3000/api` only when the project has no live entry) |
| `--json` | Output machine-readable JSON |

One row per agent spec: `id`, `type`, live `status`, `pid=<n>` where a process exists, and the
member session (`<mode>` plus `id=<8-char short>` in resume mode; `-` when none). Liveness and
session come from the server supervisor (`GET /api/processes`); an unreachable server reports
every spec `stopped` with a stderr warning. `--json` carries the full session object
(`{ mode, id }`).

## spur agent list

```
spur agent list [options]
```

| Flag | Description |
|---|---|
| `--specs` | List agent specs under `.spur/agents/` instead of detected agents |
| `--server <url>` | With `--specs`: supervisor API for live run status (default: this project's registry serve port, `http://localhost:<port>/api`; `http://localhost:3000/api` only when the project has no live entry) |
| `--json` | Output machine-readable JSON |

With `--specs`, each row carries live run status merged from the server's supervisor: trailing `status` column plus `pid=<n>` where a process exists, then the member session (`<mode>` + `id=<8-char short>`; `-` when none).
When `spur self serve` is unreachable, the listing falls back to all `stopped` with a stderr warning.

Detected agents (canonical ids from `ts-ai-runner` `DISPLAY_ORDER`, 0.4.8+): `claude`, `codex`,
`gemini`, `pi`, `omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok`.
(`antigravity` is a deprecated alias of `antigravity-cli`.) Text mode prints
`ok|missing <name> [version]`.

### JSON shape

```json
{
  "agents": [
    { "name": "claude", "installed": true, "version": "2.1.183 (Claude Code)", "channels": [], "error": null }
  ]
}
```

## spur agent doctor

```
spur agent doctor [options] [agent]
```

| Argument | Description |
|---|---|
| `agent` | Single agent to check (omit for all) |

| Flag | Description |
|---|---|
| `--probe-health` | Opt into model health probing (liveness questions are never cached) |
| `--force-refresh` | Bypass the detection cache, re-run, and rewrite it |
| `--json` | Output machine-readable JSON |

Readiness check per agent. Text mode prints an aligned table
(`<✓|✗> <usable|missing> <agent> <tier> <version>`) with a
`STATUS AGENT TIER VERSION` header and an `N usable, M missing (tier-1)` footer.
No AUTH column — the auth signal cannot distinguish "not authenticated" from
"no probe registered for the provider", so it misreported usable agents (0621).
`--json` still emits `authenticated` per agent (used by the `doctor.probe` built-in).
**Exit 1 if any tier-1 agent is not usable.** Backed by `ts-ai-runner` `DoctorRunner`.

### JSON shape

```json
{
  "agents": [
    { "agent": "claude", "installed": true, "authenticated": true, "usable": true, "tier": 1, "version": "...", "error": null }
  ]
}
```

## spur agent trace

```
spur agent trace [options] <runId>
```

| Argument | Description |
|---|---|
| `runId` | Run id to trace (a workflow run or an agent run) |

| Flag | Description |
|---|---|
| `--follow` | Poll until every run in the lineage reaches a terminal status |
| `--timeout <ms>` | `--follow` budget (default 600000); on expiry one checkpoint line is printed and the exit code is 1 |
| `--json` | Print `{ rootRunId, nodes: [{ runId, kind, status, parentRunId, sessionIds, logPath }] }` |

## spur agent wait

```
spur agent wait [options] <specId>
```

| Argument | Description |
|---|---|
| `specId` | Agent spec id whose occupant to wait on |

| Flag | Description |
|---|---|
| `--run <runId>` | Pin a specific run id (default: the spec's latest run) |
| `--inbox <id>` | Wait until queued inbox work exists for a **guest** id (heartbeating that guest's lease on every poll); exclusive with `specId`/`--role`. Exit `0` when work is pending, `1` on timeout or when the id is not a joined guest |
| `--role <name>` | Address by Layer-1 role or executor name; must resolve to exactly one materialized instance |
| `--until <state>` | Lifecycle state to wait for (repeatable OR): `idle` \| `working` \| `invoke-exit` \| `blocked`. Default `idle` |
| `--timeout <ms>` | Caller deadline in milliseconds. Omit = no deadline (stall budget still applies) |
| `--json` | `{ satisfied, pin }` on success; `{ error: { code, message } }` on failure |

Pins `specId` + `runId` + `generation` from the snapshot at wait start, then polls until the
first satisfied `--until` (OR). Replacement, generation bump, or disappearance fails fast
(`run_replaced` / `occupant_gone`). A non-working occupant that makes no progress inside
`min(timeout, 5000)ms` fails `wait_stalled`. Sole `--until blocked` is usage (exit 2) — no
first-class blocked signal in wave 2.

### Exit codes

| Code | Exit | Meaning |
|---|---|---|
| `occupant_gone` | 1 | No occupant for the specId, or it disappeared mid-wait |
| `run_replaced` | 1 | The pinned run was replaced or its generation bumped |
| `wait_stalled` | 1 | Non-working occupant, no progress within the stall budget |
| `timeout` | 1 | Caller `--timeout` elapsed (or aborted via SIGINT) |
| usage | 2 | Invalid flags, or `--until blocked` as the sole target |

```bash
spur agent wait reviewer
spur agent wait reviewer --run R3 --until invoke-exit
spur agent wait reviewer --until working --until invoke-exit --timeout 30000 --json
```

## spur agent loop

```
spur agent loop [options]
```

| Flag | Description |
|---|---|
| `--spec <id>` | Agent spec id / message recipient (required) |
| `--poll <ms>` | Wakeup backstop timeout in milliseconds (default `2000`) |

Supervisor-internal: `spur self serve` spawns one loop per started spec (`spur agent start`); not run by hand.
Each iteration: check the agent inbox → drain pending messages into a prompt → run the agent
→ wakes on ledger events (message sent, strategy/capacity change, completion receipt); `--poll` is the no-event backstop. Runs until `SIGINT` / `SIGTERM`, or until its parent `spur serve` disappears: the loop re-reads `process.ppid` every poll and shuts down when it changes, so a `SIGKILL`ed serve cannot leave an orphan loop (1088 R2).

```bash
spur agent loop --spec worker-1
spur agent loop --spec worker-1 --poll 1000
```

## spur agent start

```
spur agent start [options] <spec-id>
```

Starts a supervised agent process via `spur self serve`.

| Flag | Description |
|---|---|
| `--server <url>` | Server API URL (default: this project's registry serve port, `http://localhost:<port>/api`; `http://localhost:3000/api` only when the project has no live entry) |
| `--json` | Output machine-readable JSON |

Exit `1` when the server is unreachable or the start fails.

## spur agent stop

```
spur agent stop [options] <spec-id>
```

Stops a supervised agent process via `spur self serve`.

| Flag | Description |
|---|---|
| `--server <url>` | Server API URL (default: this project's registry serve port, `http://localhost:<port>/api`; `http://localhost:3000/api` only when the project has no live entry) |
| `--json` | Output machine-readable JSON |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.2 Implementing
- [spur message](./cmd_message.md) — `--drain` folds pending messages into the prompt
- `docs/04_DESIGN.md` — §1.1 `spur agent` family (canonical surface)
