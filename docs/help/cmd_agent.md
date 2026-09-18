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
| `doctor [agent]` | Check agent readiness (usable, authenticated, version) |
| `wait <specId>` | Identity-pinned wait for an occupant run to reach a lifecycle state |
| `loop` | Supervisor-internal self-draining loop for an agent spec (hidden from `--help`) |
| `start <spec-id>` | Start a supervised agent process (requires `spur serve`) |
| `stop <spec-id>` | Stop a supervised agent process (requires `spur serve`) |

## spur agent run

```
spur agent run [options] <prompt>
```

| Flag | Description |
|---|---|
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline`. A **role** (`scribe`/`coder`/`reviewer`/`planner`) selects the starting tier; an **executor** pins a configured profile; a bare binary name works with a one-time warning; `auto` (default) resolves via the `agent` config block. Explicit `inline` is host-session-only — this surface is headless, so it is rejected with exit 2 and a stable error message (G5 / ADR-047 amendment; it never normalizes to `agent.default`). `spur agent run` always starts a subprocess. |
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
availability. Schedule it externally (cron/launchd); `spur serve` never runs it.
Healthy providers whose windows are exhausted disable their executors (owner
`quota`); recovered headroom re-enables them. Providers matching no configured
executor are listed as unmapped, never guessed. A missing or failing codexbar
run is fail-closed: nothing is written and the command exits non-zero.

## spur agent list

```
spur agent list [options]
```

| Flag | Description |
|---|---|
| `--specs` | List agent specs under `.spur/agents/` instead of detected agents |
| `--server <url>` | With `--specs`: supervisor API for live run status (default `http://localhost:3000/api`) |
| `--json` | Output machine-readable JSON |

With `--specs`, each row carries live run status merged from the server's supervisor: trailing `status` column plus `pid=<n>` where a process exists.
When `spur serve` is unreachable, the listing falls back to all `stopped` with a stderr warning.

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

Supervisor-internal: `spur serve` spawns one loop per started spec (`spur agent start`); not run by hand.
Each iteration: check the agent inbox → drain pending messages into a prompt → run the agent
→ wakes on ledger events (message sent, strategy/capacity change, completion receipt); `--poll` is the no-event backstop. Runs until `SIGINT` / `SIGTERM`.

```bash
spur agent loop --spec worker-1
spur agent loop --spec worker-1 --poll 1000
```

## spur agent start

```
spur agent start [options] <spec-id>
```

Starts a supervised agent process via `spur serve`.

| Flag | Description |
|---|---|
| `--server <url>` | Server API URL (default `http://localhost:3000/api`) |
| `--json` | Output machine-readable JSON |

Exit `1` when the server is unreachable or the start fails.

## spur agent stop

```
spur agent stop [options] <spec-id>
```

Stops a supervised agent process via `spur serve`.

| Flag | Description |
|---|---|
| `--server <url>` | Server API URL (default `http://localhost:3000/api`) |
| `--json` | Output machine-readable JSON |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.2 Implementing
- [spur message](./cmd_message.md) — `--drain` folds pending messages into the prompt
- `docs/04_DESIGN.md` — §1.1 `spur agent` family (canonical surface)
