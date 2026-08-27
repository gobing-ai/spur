---
name: spur-cli-agent
description: "spur-cli noun reference: operate `spur agent` as the coding-agent execution surface - run prompts via detected or named agents, manage team agent specs, run the persistent self-draining loop, and check agent readiness. The concrete levers (--model, --agent) behind the dispatch-surface escalation rule."
see_also:
  - spur-cli
---

# spur agent - the coding-agent execution surface

`spur agent` is the CLI for **running and inspecting coding agents**. It wraps the agents the
operator already has installed (Claude Code, Codex, omp, OpenCode, Antigravity, etc.) behind a
uniform `run` / `loop` / `spec` surface, so the rest of the harness can dispatch work without
hard-coding a specific agent.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*. The decision of *when* to escalate from a native subagent to `spur agent run` is owned
by the **[dispatch-surface rule](../../parallel-execution/references/dispatch-surface.md)** - read
that before using `run` for fan-out dispatch.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `run <prompt>` | Execute a prompt or slash command via a coding agent | `--agent <name>` `--spec <id>` `--model <name>` `--mode <mode>` `--continue` `--cwd <path>` `--drain` `--json` |
| `loop` | Persistent self-draining inbox loop for a team member (supervisor-managed) | `--spec <id>` `--agent <id>` `--poll <ms>` |
| `wait [<specId>]` | Identity-pinned wait for an occupant run to reach a lifecycle state (G4 wave 2; `--role` selector per 0685) | `--role <name>` `--run <runId>` `--until <state>...` `--timeout <ms>` `--json` |
| `list` | List detected coding agents, or team agent specs with `--specs` | `--specs` `--json` |
| `doctor [agent]` | Check agent readiness | `--json` `--probe-health` `--force-refresh` |
| `create <id>` | Write a team agent spec to `.spur/agents/<id>.yaml` | `--type` `--tags` `--model` `--autonomy` `--system-prompt` `--name` `--workspace` `--purpose` `--auto-start` `--no-identity-preamble` `--json` |
| `edit <id>` | Open an agent spec in `$EDITOR`, or print its path | - |
| `delete <id>` | Remove an agent spec | `--force` |

All verbs accept `--json` for machine consumption. **Exit codes:** `0` success, `1` error, `2`
invalid usage.

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
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline`. A **role** (`scribe`/`coder`/`reviewer`/`planner`, from `plugins/sp/references/roles.md`) selects the starting tier; an **executor** (an `agent.executors` entry) is a permanent pin; a **bare binary name** works with a one-time warning (transition shim); `auto` uses the declared/default role. **`inline` is host-session-only** (G5 / ADR-047 amendment): `agent run` is a headless subprocess surface, so explicit `inline` is rejected with exit 2 and a stable error message — it never normalizes to `agent.default`. |
| `--model <name>` | Agent model argument (e.g. `o3`, `sonnet`). Passed through to the agent's model flag. |
| `--mode <mode>` | Agent output mode: `text` or `json`. |
| `--continue` | Resume the previous agent session instead of starting fresh. |
| `--cwd <path>` | Working directory for agent execution (default: current directory). |
| `--spec <id>` | Team agent spec id (occupant addressing, 0542 R1). Pairs with `--drain`; with `--spec` alone the run is addressed to the occupant without touching the inbox. A legacy `--agent <spec-id>` still works during the transition with a one-time warning (shim `agent-flag-spec-id`). |
| `--drain` | Prepend pending inbox messages addressed to `--spec <id>` before the prompt. |
| `--json` | Output machine-readable JSON where supported. |

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

## `loop` - persistent self-draining wrapper

```bash
spur agent loop --agent worker-1 --poll 2000
```

`loop` is the **persistent self-draining wrapper** used by the team supervisor. It polls the
addressed agent's inbox, drains each pending message into an `agent run` invocation, and idles
between drains. It is not typically invoked directly by the operator - `spur team start` launches it
under supervision.

### Flags

| Flag | Purpose |
|------|---------|
| `--spec <id>` | **Required.** Team agent spec id / message recipient (0542 R1; legacy `--agent <spec-id>` still read with a one-time warning). |
| `--poll <ms>` | Idle poll interval in milliseconds (default: `2000`). |

The loop runs until `SIGINT` / `SIGTERM`. Each iteration: check inbox -> if messages, drain each
into `run` with `--drain` -> else sleep for `--poll` ms.

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
naming count + candidates (`selector_unmatched` / `selector_ambiguous`, exit 1), an unknown name
exits 2 naming the accepted vocabulary. Resolution collapses onto the same identity pin.

### Flags

| Flag | Purpose |
| ------ | --------- |
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

## `list` - detected agents and team specs

```bash
spur agent list              # detected coding agents on this machine
spur agent list --specs      # team agent specs under .spur/agents/
spur agent list --json       # machine-readable
```

Without `--specs`, lists coding agents detected on the host (by binary on `PATH`). With `--specs`,
lists team agent specs (`.spur/agents/*.yaml`).

## `doctor` - readiness check

```bash
spur agent doctor            # all detected agents
spur agent doctor claude     # one agent (executor/agent name → detail block)
spur agent doctor coder      # pipeline role id → eligible ladder with ELECTED marker
spur agent doctor --json     # machine-readable (role selector: elected-first ordering)
```

Checks whether each agent is installed and ready to run. Text mode renders a capability table —
`STATUS EXECUTOR AGENT MODEL TIER VERSION ROLES` where TIER is the executor's *capability* tier
(`cheap|standard|capable-*`), MODEL the pinned config model (`—` when undeclared), and ROLES lists
candidate pipeline roles with `*` on the elected one. Exit `1` if any checked agent is not ready.

## `create` - author a team agent spec

```bash
spur agent create worker-1 --type claude --tags team:alpha --model sonnet
spur agent create reviewer --type codex --autonomy review --auto-start
```

Writes a team agent spec to `.spur/agents/<id>.yaml`. The spec captures the agent's identity
(type, model, autonomy, system prompt, tags) so `spur team up` can materialize a roster and `spur
agent loop` can self-drain its inbox.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--type <agent-type>` | Agent spec type (e.g. `claude`, `codex`, `omp`). |
| `--tags <a,b>` | Comma-separated team identity tags (e.g. `team:alpha,role:worker`). |
| `--model <name>` | Agent model argument. |
| `--autonomy <level>` | Autonomy level (e.g. `full`, `review`). |
| `--system-prompt <text>` | Team identity system prompt. |
| `--name <name>` | Agent display name. |
| `--workspace <path>` | Workspace path for this agent. |
| `--purpose <text>` | Team identity purpose. |
| `--auto-start` | Auto-start flag (start on `team up` without manual `team start`). |
| `--no-identity-preamble` | Disable the identity preamble prepended to prompts. |
| `--json` | Output machine-readable JSON. |

## `edit` - open a spec in `$EDITOR`

```bash
spur agent edit worker-1
```

Opens `.spur/agents/<id>.yaml` in `$EDITOR`. If `$EDITOR` is unset, prints the spec path instead.

## `delete` - remove a spec

```bash
spur agent delete worker-1 --force
```

`--force` is required (guards against accidental deletion). Removes `.spur/agents/<id>.yaml`.

## What this skill is NOT

- **Not the dispatch decision.** *When* to use `spur agent run` vs a native subagent is the
  **[dispatch-surface rule](../../parallel-execution/references/dispatch-surface.md)**, not this
  reference. This reference documents the verbs; that rule decides which surface carries a dispatch.
- **Not the team orchestrator.** `spur team up` / `spur team start` drive the supervisor lifecycle;
  `spur agent` provides the execution primitives they compose.

## See also

- **[dispatch-surface.md](../../parallel-execution/references/dispatch-surface.md)** - native
  subagent vs `spur agent run` decision rule. `--model` and `--agent` are its escalation levers.
- **`spur team` (see [team.md](team.md))** - team lifecycle that launches `agent loop` under
  supervision.
- **`spur message` (see [message.md](message.md))** - the inbox `--drain` reads from.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
