---
name: spur-cli-team
description: "spur-cli noun reference: operate `spur team` as the team coordination surface - assign agents to tasks, inspect grouped status, materialize and tear down team rosters, and start/stop supervised agent processes. The lifecycle layer over `spur agent` specs."
see_also:
  - spur-cli
---

# spur team - team coordination and supervision

`spur team` is the CLI for **coordinating team agent assignments and supervision**. It sits above
`spur agent` specs: `up` / `down` materialize and tear down rosters, `start` / `stop` manage
supervised processes (requiring `spur serve`), `assign` wires tasks to agents, and `status` reports
the live picture.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `assign <task-id> <agent-id>` | Set the assignee on a task file | - |
| `status` | List agent specs and their run status; `--by-team` groups by team | `--by-team` `--server <url>` `--json` |
| `up <team>` | Materialize a team roster into specs; best-effort start | `--check` `--server <url>` `--json` |
| `down <team>` | Tear down a team: stop members; `--purge` removes generated specs | `--purge` `--server <url>` `--json` |
| `start <agent-id>` | Start a supervised agent process (requires `spur serve`) | `--server <url>` `--json` |
| `stop <agent-id>` | Stop a supervised agent process (requires `spur serve`) | `--server <url>` `--json` |

All verbs except the text-only `assign` accept `--json` and `--json-envelope`. `--server <url>` (default:
`http://localhost:3000/api`) targets the supervisor API started by `spur serve`. **Exit codes:** `0`
success, `1` error, `2` invalid usage.

## `assign` - wire a task to an agent

```bash
spur team assign 0040 worker-1
```

Sets the `assignee` field on the task file `<task-id>` to `<agent-id>`. This is the traceability edge
between the task corpus and the team roster - it records *who* is responsible, not *what* they run.

## `status` - agent specs and run state

```bash
spur team status                    # flat list
spur team status --by-team          # grouped by team:<id> membership
spur team status --json             # machine-readable
```

Lists agent specs and their live run status. When `spur serve` is reachable, enriches each spec with
the supervisor's process status (`running` / `stopped` / etc.); otherwise falls back to local spec
metadata. Each row carries the member's declared `role` (rendered `unset` when undeclared, 0544)
and the spec's `executor`. `--by-team` groups specs by their `agent.team.<id>` tag.

### Flags

| Flag | Purpose |
|------|---------|
| `--by-team` | Group specs by their `agent.team.<id>` membership (0258 R4). |
| `--server <url>` | Server API URL for live run status (default: `http://localhost:3000/api`). |
| `--json` | Output machine-readable JSON. |

## `up` - materialize a team roster

```bash
spur team up alpha                  # materialize + best-effort start
spur team up alpha --check          # dry-run: show add/prune diff, no writes
spur team up alpha --json
```

Materializes the roster declared under `agent.team` in the project config for `<team>` into
`.spur/agents/` specs - adding missing specs and pruning stale `spur:generated` ones. **Role is
the primary axis (0543):** a member declares `role` (`scribe`/`coder`/`reviewer`/`planner`,
from `plugins/sp/references/roles.md`) and/or `executor`; a role-only member resolves an executor
through the shared tier ladder at materialization, and the written spec records both `role` and
the resolved `executor` so the decision is inspectable. A member declaring neither fails config
load naming the team and position. Local id stays `id ?? executor`; role-only members derive
`<role>-<n>` by declaration order. Generated specs carry the `agent.team.<team>` tag. When `spur serve` is
reachable, best-effort starts each member. `--check` is a dry-run that shows the add/prune diff
without writing.

### Flags

| Flag | Purpose |
|------|---------|
| `--check` | Dry-run: show the add/prune diff without writing. |
| `--server <url>` | Server API URL (default: `http://localhost:3000/api`). |
| `--json` | Output machine-readable JSON. |

## `down` - tear down a team

```bash
spur team down alpha                # stop members
spur team down alpha --purge        # also delete spur:generated specs
spur team down alpha --json
```

Stops all members of `<team>` via the supervisor. `--purge` also deletes specs marked `spur:generated`
(never manual or `ref:` specs) - use it to fully clean up a materialized roster.

### Flags

| Flag | Purpose |
|------|---------|
| `--purge` | Also delete `spur:generated` specs (never manual / `ref:`). |
| `--server <url>` | Server API URL (default: `http://localhost:3000/api`). |
| `--json` | Output machine-readable JSON. |

## `start` / `stop` - supervised process control

```bash
spur team start worker-1            # start supervised process
spur team stop worker-1             # stop supervised process
spur team start worker-1 --json
```

Start or stop a supervised agent process. **Requires `spur serve`** to be running - these verbs go
through the server's supervisor API (`POST /api/team/start`, `POST /api/team/stop`), not local
process spawning. The started process runs `spur agent loop --agent <id>` under supervision.

### Flags

| Flag | Purpose |
|------|---------|
| `--server <url>` | Server API URL (default: `http://localhost:3000/api`). |
| `--json` | Output machine-readable JSON. |

## What this skill is NOT

- **Not the agent runner.** `start` launches `spur agent loop` under supervision; the loop's
  execution primitives are documented in **[agent.md](agent.md)**.
- **Not the message transport.** Team agents communicate via `spur message`; see
  **[message.md](message.md)**.

## See also

- **`spur agent` (see [agent.md](agent.md))** - the execution primitives `team start` supervises.
- **`spur message` (see [message.md](message.md))** - the durable inbox team members drain.
- **`spur serve` (see [serve.md](serve.md))** - the local server `start`/`stop`/`status` require.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
