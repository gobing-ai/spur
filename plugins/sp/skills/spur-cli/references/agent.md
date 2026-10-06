---
name: spur-cli-agent
description: "spur-cli noun reference: operate `spur agent` as the coding-agent execution surface - run prompts, wait on pinned occupants, list agent specs, start/stop supervised processes, and check readiness."
see_also:
  - spur-cli
---

# spur agent - the coding-agent execution surface

`spur agent` is the CLI for **running and inspecting coding agents**. It wraps the agents the
operator already has installed (Claude Code, Codex, omp, OpenCode, Antigravity, etc.) behind a
uniform run, wait, and supervision surface, so the rest of the harness can dispatch work without
hard-coding a specific agent.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*. The decision of *when* to escalate from a native subagent to `spur agent run` is owned
by the **[dispatch-surface rule](../../parallel-execution/references/dispatch-surface.md)** - read
that before using `run` for fan-out dispatch.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `run <prompt>` | Execute a prompt or slash command via a coding agent | `--agent <name>` `--spec <id>` `--model <name>` `--mode <mode>` `--continue` `--cwd <path>` `--drain` `--json` |
| `wait [<specId>]` | Identity-pinned wait for an occupant run to reach a lifecycle state (G4 wave 2; `--role` selector per 0685) | `--role <name>` `--run <runId>` `--until <state>...` `--timeout <ms>` `--json` |
| `trace <runId>` | Print one execution record's lineage — the run, its dispatch parents, agent session ids and streams (1076 R4, ADR-132) | `--follow` `--timeout <ms>` `--json` |
| `list` | List detected coding agents, or agent specs with `--specs` (live run status + member session merged from `spur self serve`) | `--specs` `--server <url>` `--json` |
| `report` | Report a fleet member lifecycle state (`working`/`idle`/`blocked`) from a host hook (G73 R1/R2, task 1080) | `--state <state>` `--seq <ns>` `--spec <id>` `--json` |
| `join` | Join the fleet as a guest occupant — a live session that pulls its own work (G73 R2, task 1081) | `--role <name>` `--id <id>` `--session-id <sid>` `--pid <n>` `--executor <name>` `--json` |
| `leave` | Leave the fleet: release the guest lease, retire the occupant, return claimed messages to pending | `[id]` `--session-id <sid>` `--json` |
| `status` | Agent specs with live process status and member session (requires `spur self serve`) | `--server <url>` `--json` |
| `doctor [agent]` | Check agent readiness | `--json` `--probe-health` `--force-refresh` |
| `usage` | Run-once provider usage capture (codexbar) → quota-owned availability refresh; scheduled externally | `--dry-run` `--source <name>` `--json` |
| `start <spec-id>` | Start a supervised agent process (requires `spur self serve`) | `--server <url>` `--json` |
| `stop <spec-id>` | Stop a supervised agent process (requires `spur self serve`) | `--server <url>` `--json` |

`list`, `status`, `doctor`, `run`, `wait`, `trace`, `start`, and `stop` accept `--json` plus `--json-envelope`. The hidden
`loop` is a supervisor-internal process surface. **Exit codes:** `0` success, `1` failure, and `2`
invalid usage; `run` can also propagate the invoked agent's non-zero result.

## `run` - execute a prompt via a coding agent

```bash
spur agent run "Fix the login bug in src/auth/" --agent coder
spur agent run "verify on o3" --agent reviewer --model o3
spur agent run "/sp:dev-verify 0040" --agent omp --drain
```

`run` is the verb the **dispatch-surface rule** escalates to. It executes a prompt (or slash command)
through a coding agent as an external process, producing a persisted run record under `.spur/run/`.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline`. A **role** (`scribe`/`coder`/`reviewer`/`planner`, from `plugins/sp/references/roles.md`) selects the starting tier; an **executor** (an `agent.executors` entry) is a permanent pin; a **bare binary name** works with a one-time warning (transition shim); `auto` uses the declared/default role. `inline` is the default selector (0687 / ADR-087): on a host session the work runs in-session; on a headless subprocess surface like `agent run` it substitutes tier resolution and warns once naming the resolved executor — no rejection, no `agent.default` normalization. |
| `--model <name>` | Agent model argument (e.g. `o3`, `sonnet`). Passed through to the agent's model flag. |
| `--mode <mode>` | Agent output mode: `text` or `json`. |
| `--continue` | Resume the previous agent session instead of starting fresh. |
| `--cwd <path>` | Working directory for agent execution (default: current directory). |
| `--spec <id>` | Agent spec id (occupant addressing, 0542 R1). Pairs with `--drain`; with `--spec` alone the run is addressed to the occupant without touching the inbox. A legacy `--agent <spec-id>` is still accepted as fallback addressing (task 0849 retired the `agent-flag-spec-id` deprecation warning). |
| `--drain` | Prepend pending inbox messages addressed to `--spec <id>` before the prompt. |
| `--json` | Output machine-readable JSON where supported. |
| `--json-envelope` | Wrap JSON using the facade's standard output contract. |

`--json` adds a `resolved` block (`{ role?, tier?, executor?, agent, source }`) reporting the
resolution decision — the role, its tier, and the executor that won for role routing; the pin for
an explicit executor; the canonical agent; and the resolution source.

### Dispatch-surface cross-reference

`--agent` and `--model` are the **concrete levers** behind dispatch-surface trigger 1 ("Different
model or coding agent required"). When a step needs a model or coding agent the host session cannot
provide, `spur agent run --agent <name> --model <name>` is the escalation path. See
**[dispatch-surface.md](../../parallel-execution/references/dispatch-surface.md)** for the full
trigger table and the naming requirement (state which trigger applied).

**Default:** use the native subagent (`Skill()` / `Task()`) when the host platform provides one.
`spur agent run` is the exception, not the default - it is justified only by one of the four
observable triggers (different model/agent, headless step, durable audit record, workspace
isolation).

### Sandbox reliability note

`spur agent run` spawns the target agent as an external process. Under a sandboxed Bash session it
can fail when the external agent writes its own storage outside the sandbox's allowlist (e.g. omp's
`AgentStorage` SQLite DB). This is not a reason to abandon `spur agent run` - triggers 1-4 still
justify it - but ensure the run executes in a context that can write the target agent's storage.

## `loop` - supervisor-internal self-draining wrapper (hidden)

`spur agent loop --spec <id> [--poll <ms>]` is spawned by the `spur self serve` supervisor for each
materialized agent spec; it is hidden from `--help` and not an operator verb (use `spur agent start`).
It waits for a wake on the `system_events` ledger — a human request (`message.sent`), a strategy
change (`strategy.changed`), a capacity change (`fleet.capacity.changed`), or a completion receipt
(`agent.invoke.exit`) — then drains the inbox into an `agent run` invocation. An idle wake records
the hold reason instead of dispatching; with no wake event it still drains every `--poll` ms
(default `2000`). It runs until `SIGINT` / `SIGTERM`, or until its parent `spur serve` disappears —
the parent is re-read each poll and a change aborts the loop, so a `SIGKILL`ed serve leaves no
orphan loop (1088 R2).

## `wait` - identity-pinned occupant wait (G4 wave 2)

```bash
spur agent wait reviewer                          # default --until idle
spur agent wait reviewer --run R3 --until invoke-exit
spur agent wait reviewer --until working --until invoke-exit --timeout 30000 --json
spur agent wait --role reviewer                   # role-addressed: resolves to exactly one instance
```

`wait` pins an occupant's identity (`specId` + `runId` + `generation`) from the snapshot at wait
start, then polls until the first satisfied `--until` (OR). `--run` pins an explicit run; default
is the spec's latest run. Replacement, generation bump, or disappearance fails fast; a non-working
occupant that makes no progress inside the stall budget fails `wait_stalled`.
Addressing takes `<specId>` **or** `--role` — never both. `--role` resolves against materialized
instances (vocabulary = `AGENT_ROLE_NAMES` ∪ executor names); zero/multi matches are hard errors
naming `count=0` + candidates `none` or `count=N` + candidate ids
(`selector_unmatched` / `selector_ambiguous`, exit 1), an unknown name
exits 2 naming the accepted vocabulary. Resolution collapses onto the same identity pin.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--role <name>` | Resolve a Layer-1 role or executor name to exactly one materialized instance; mutually exclusive with `[specId]`. |
| `--run <runId>` | Pin a specific run id (default: the spec's latest run). |
| `--until <state>` | Lifecycle state to wait for (repeatable OR): `idle` \| `working` \| `invoke-exit` \| `blocked`. Default `idle`. |
| `--timeout <ms>` | Caller deadline. Undefined = no deadline (stall budget still applies). |
| `--json` | `{ satisfied, pin }` on success; `{ error: { code, message } }` on failure. |

### Exit codes + error envelope

| Code | Exit | Meaning |
| ------ | ------ | --------- |
| `occupant_gone` | 1 | No occupant for the specId, or it disappeared mid-wait. |
| `run_replaced` | 1 | The pinned run was replaced or its generation bumped. |
| `wait_stalled` | 1 | Non-working occupant, no progress within `min(timeout, 5000)ms`. |
| `timeout` | 1 | Caller `--timeout` elapsed (or aborted via SIGINT). |
| `usage` | 2 | Invalid flags, or `--until blocked` as the sole target (no first-class signal in wave 2). |

## `list` - detected agents and agent specs

```bash
spur agent list              # detected coding agents on this machine
spur agent list --specs      # agent specs under .spur/agents/
spur agent list --json       # machine-readable
```

Without `--specs`, lists coding agents detected on the host (by binary on `PATH`). With `--specs`,
lists agent specs (`.spur/agents/*.yaml`) **with live run status merged from the server's
supervisor**: each row carries a trailing status column
(`running` / `stopped` / `errored` / `unknown`), `pid=<n>` where a process exists, and the member
session (0897): the session mode plus a shortened resume id (`resume id=3f9c2a1d`), or `-` when the
member has no recorded session. When `spur self serve` is unreachable, the listing falls back to all
`stopped` with a stderr warning. `--server <url>` targets the supervisor API; without it the URL is
this project's serve — the port in the cwd's project-registry entry (`http://localhost:<port>/api`),
falling back to `http://localhost:3000/api` only when the project has no live entry (1088 R1).

```bash
spur agent list --specs
# planner	claude	reviewer	claude	plans the work	running pid=4132	resume id=3f9c2a1d
# worker-1	pi	worker	pi	implements	stopped	one-shot
```

## `status` - live status + member session per spec

```bash
spur agent status            # id, type, status, pid, session — one row per spec
spur agent status --json     # full objects, session carried whole ({ mode, id })
```

Reads the same supervisor feed as `list --specs` (liveness **and** session come from
`GET /api/processes`; the served project's ledger is the source of the session state). An
unreachable server reports every spec `stopped` with no session. `--server <url>`
(default: this project's registry serve port, `http://localhost:<port>/api`; else
`http://localhost:3000/api` — 1088 R1) targets it. See
[Member sessions](#member-sessions-g66) for what the modes mean.

## `report` - fleet lifecycle state from a host hook (G73, task 1080)

```bash
spur agent report --state working --seq 1759665600000000000
spur agent report --state blocked --seq 1759665600000000000 --spec proj-worker-1 --json
```

| Flag | Description |
| --- | --- |
| `--state <state>` | Lifecycle state: `working` \| `idle` \| `blocked` (required) |
| `--seq <ns>` | Monotonic report sequence in nanoseconds (required); not greater than the last accepted one → ignored |
| `--spec <id>` | Member spec id; defaults to `SPUR_SPEC_ID` |
| `--json` | Machine-readable result (`accepted`, `observation`) |
| `--json-envelope` | Wrap the JSON in the standard output envelope |

An accepted report writes the cataloged `agent.lifecycle.changed` ledger row — the newest
accepted row for the member is its current state, so there is no separate state store. The
dispatch strategy treats `blocked` as unavailable (hold reason `member-blocked`), and the Board
shows `needs human` on that member.

Exit `2` when `--state`/`--seq` is missing or malformed, or when no member id resolves
(`SPUR_SPEC_ID` unset and no `--spec`). The `sp` plugin's `agent-lifecycle` host hook calls this
in the background on `SessionStart` (idle), `UserPromptSubmit` (working), `Notification`
(`permission_prompt` → blocked) and `Stop` (idle); outside a fleet it makes no call at all.

## `join` / `leave` - guest occupancy (G73 R2/R5, task 1081)

```bash
spur agent join --role reviewer --json          # id defaults to <role>-g<n>
spur agent join --role coder --id my-session --json
spur agent leave --json                          # the guest joined by this session
```

A guest is a live session that **pulls** work: never supervised, never restarted, addressable by
concrete id only (role/executor selectors count declared members, so a guest is invisible to them).
`join` writes an occupant row in `coordination_runs`, claims a `guest:<id>` lease on the shared
claim table (same TTL/heartbeat semantics as the write slot — R5) and writes
`.spur/run/guests/<id>.json` so a host Stop hook can recognize its own session without a CLI call.
`leave`, or lease expiry in the reconciler pass, releases the lease, marks the occupant exited,
returns its claimed messages to `pending` and removes the record.

| Flag | Description |
| --- | --- |
| `--role <name>` | Layer-1 role (`scribe` \| `coder` \| `reviewer` \| `planner`); required for `join` |
| `--id <id>` | Guest id (defaults to `<role>-g<n>`); colliding with a declared member or a joined guest exits 2 |
| `--session-id <sid>` | Host session id (defaults to `CLAUDE_CODE_SESSION_ID`) |
| `--pid <n>` | Process id to record |
| `--executor <name>` | Executor name to record (informational — a guest is never dispatched to) |
| `--json` | Machine-readable result |

A guest carrying no executor attestation is never a stage target: `spur agent run --spec <guest-id>`
is refused (R3), and `requiresCapabilities` stages therefore can never reach one.

## `wait --inbox <id>` - the guest pull primitive (G73 R4)

```bash
spur agent wait --inbox reviewer-g1 --timeout 540000 --json
```

Returns `0` as soon as queued inbox work exists for the guest and `1` on timeout or when the id is
not a joined guest — never a silent hang. Every call heartbeats the guest's lease, so a session that
keeps looping stays joined; the timeout stays under the Bash tool's ~10-minute limit. The
`fleet-join` skill loops it (wait → `spur message inbox --agent <id>` → work → `spur message reply`),
and the `fleet-guest-stop` plugin hook delivers the same messages at a turn boundary on hosts that
support a blocking Stop hook.

## `doctor` - readiness check

```bash
spur agent doctor            # all detected agents
spur agent doctor claude     # one agent (executor/agent name → detail block)
spur agent doctor coder      # pipeline role id → eligible ladder with ELECTED marker
spur agent doctor --json     # machine-readable (role selector: elected-first ordering)
```

Checks whether each agent is installed and ready to run. Text mode renders a capability table —
`STATUS EXECUTOR AGENT MODEL TIER VERSION CAPS ROLES OWNER SINCE REASON` where TIER is the executor's *capability* tier
(`cheap|standard|capable-*`), MODEL the pinned config model (`—` when undeclared), ROLES lists
candidate pipeline roles with `*` on the elected one, CAPS is the runner-declared session
capability for the underlying agent binary (`r`esume/`d`ir/`s`tdin/`o`utput as ✓/✗; `—` when the
binary is unknown to the runner; a trailing `⚠` when the detected version core differs from the
record's `verifiedAgainst` core — branding decorations are not drift, and a record/detection with
no version core (e.g. `unverified (CLI not installed)`) is unverifiable and never warns; a stale
executor also emits a `capability-declaration-stale` warning
on stderr in text mode), and OWNER/SINCE/REASON (0893) show availability provenance on `disabled`
rows — bare `disabled: true` renders owner `operator` with `—` since/reason; object-form disables
render their recorded values. A `usage:` footer reports the `agent usage` snapshot (`capturedAt
(age)`, `(stale)` past 6 h, or `usage: none` when the producer has never run). `--json` stays
stderr-clean and carries `capabilities`, `capabilityStale: {verifiedAgainst, detected}`, the
normalized `availability` object, and a top-level `usage` per agent row instead. Exit `1` if any
checked agent is not ready.

## `trace` - one execution record's lineage (1076 R4, ADR-132)

```bash
spur agent trace <runId>              # the run, its parents, its children
spur agent trace <rootId> --follow    # poll until every run in the lineage is terminal
spur agent trace <runId> --json
```

`trace` reports ADR-132's execution record as one lineage. A node is a run: a workflow run comes from
the `runs` table, an agent run from `coordination_runs`, and the dispatch edge is
`coordination_runs.parent_run_id` — set from a workflow dispatch key (`<runId>/<state>`) or the
inherited `SPUR_RUN_ID`. `trace <runId>` first walks that edge UP to the root and then DOWN to the
leaves, so any id in the chain yields the whole picture. Each node carries its status, the agent
session ids recorded for it (`history_run_session`, exact rows only) and its durable stream under
`.spur/memory/runs/<runId>.md` when one was written. The stream is the record; the supervisor's ring
buffer is only a live view.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--follow` | Poll until every run in the lineage reaches a terminal status. |
| `--timeout <ms>` | `--follow` budget (default 600000). On expiry one checkpoint line is printed and the command exits 1; the runs continue. |
| `--json` | `{ rootRunId, nodes: [{ runId, kind, status, parentRunId, sessionIds, logPath }] }` — root first, depth-first. |

## `start` - start a supervised process

```bash
spur agent start worker-1
spur agent start worker-1 --json
```

Posts to the `spur self serve` supervisor API
(`POST /api/agents/:id/start`) and prints `started <id> (pid=<n>, status=<s>)`. Requires a
reachable `spur self serve`; `--server <url>` targets it, defaulting to this project's registry
serve port (`http://localhost:<port>/api`, else `http://localhost:3000/api` when the project has no
live entry — 1088 R1). Exit `1`
when the server is unreachable or the start fails.

## `stop` - stop a supervised process

```bash
spur agent stop worker-1
spur agent stop worker-1 --json
```

Posts to the supervisor API
(`POST /api/agents/:id/stop`) and prints `stopped <id>`. Same server requirement and flags as
`start`.

## `usage` - run-once provider usage capture (quota-owned availability refresh)

```bash
spur agent usage            # capture, record quota observations, drain them
spur agent usage --dry-run  # print would-be changes; write nothing
spur agent usage --json
```

Runs `codexbar usage --format json --provider all` once, writes the snapshot to
`~/.config/spur/agent-usage.json` (`captured_at`, `source`, `providers[]`, `raw`), maps providers
to executors via `agent.executors[].agent` (or the model's `<provider>/` prefix), and records
`owner: quota` availability observations that the standard drain applies — the single availability
write path. A provider is exhausted when any `primary|secondary|tertiary` window reports
`usedPercent >= 100`; the window name and `resetsAt` go into the observation reason. Per-provider
`{ "error": … }` entries are skipped (listed, never treated as recovery); healthy entries still
apply. Providers whose windows are all null carry no signal (`no-usage`): they are reported and
excluded from availability decisions — an absent signal neither disables nor recovers, and an
exhausted signal wins on shared executors. Operator-owned availability (`disabled: true` or an
operator ownership object) is never touched. A missing codexbar binary or an unparsable payload
exits `1` and changes nothing. Unmapped providers are listed and never guessed.

Each reported change carries a delivery-semantics `action` (0907): `would-apply` (dry run),
`applied` — the exact observation created by the invocation was acknowledged without a skip
(desired state confirmed; not proof of a YAML byte change), `no-op` — already satisfied or
operator-owned, `skipped` — the observation was superseded or rejected, `pending` — delivery
unconfirmed or failed. For `skipped`/`pending` the printed target is intent only.

**Scheduling is external** (cron/launchd, same pattern as `spur history daily`):

```bash
# launchd/cron example — hourly
0 * * * * /opt/homebrew/bin/spur agent usage >> /tmp/spur-agent-usage.log 2>&1
```

`spur self serve` never invokes the producer (asserted by a test, design R4).

### Flags

| Flag | Purpose |
| ---- | ------- |
| `--dry-run` | Print would-be changes (executor, from → to, owner, reason); write neither the snapshot nor any config |
| `--source <name>` | Usage source implementation; only `codexbar` exists (default) |
| `--json` | Machine-readable result payload |

## Member sessions (G66)

Every fleet member loop keeps ONE coding-agent session for its lifetime, in the warmest mode the
agent supports (`docs/design/session-pinned-dispatch.md` §6):

| Mode | Mechanism | `id` |
| ---- | --------- | ---- |
| `persistent` | One long-lived stdin process; each drained prompt is injected through `send()` | none — the live process IS the session |
| `resume` | Each drain re-opens the previous drain's session id | the resume id (rendered shortened) |
| `one-shot` | A fresh session per drain (one lifetime warning per member) | none |

A session **resets** (the ledger records a reason-named `fleet.member-session-reset` row) on:
`restart` — the persistent process exited and the supervisor's restart policy respawns it;
`operator` — `spur agent stop` / serve shutdown ended the loop; `failed-drains` — 3 consecutive
failed drains marked the session poisoned. The next drain opens a fresh session.

**No-redelivery invariant:** delivery state lives in the DB, session continuity is agent memory
only. A settled (delivered) inbox message is never redelivered — resuming a session or resetting
one never re-sends settled work; only never-started deliveries release and redeliver (0831/0834).

## What this skill is NOT

- **Not the dispatch decision.** *When* to use `spur agent run` vs a native subagent is the
  **[dispatch-surface rule](../../parallel-execution/references/dispatch-surface.md)**, not this
  reference. This reference documents the verbs; that rule decides which surface carries a dispatch.
- **Not the fleet orchestrator.** The `spur self serve` supervisor drives the lifecycle: `spur agent
  start` / `stop` manage supervised processes and `agent list --specs` reports live state.

## See also

- **[dispatch-surface.md](../../parallel-execution/references/dispatch-surface.md)** - native
  subagent vs `spur agent run` decision rule. `--model` and `--agent` are its escalation levers.
- **`spur message` (see [message.md](message.md))** - the inbox `--drain` reads from.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
