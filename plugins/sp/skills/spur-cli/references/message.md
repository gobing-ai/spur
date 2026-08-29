---
name: spur-cli-message
description: "spur-cli noun reference: operate `spur message` as the durable inter-agent messaging surface - send, inbox, reply, and watch. The inbox that `spur agent run --drain` and `spur agent loop` consume."
see_also:
  - spur-cli
---

# spur message - durable inter-agent messaging

`spur message` is the CLI for **durable inter-agent messages**. Messages are persisted (not
ephemeral), so an agent can drain its inbox on the next `run --drain` or `loop` iteration even if it
was offline when the message was sent. This is the inbox surface that `spur agent run --drain` and
`spur agent loop` consume.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `send <body>` | Enqueue a message for an agent | `--to <id>` `--role <name>` `--from <id>` `--wait` `--until <state>` `--timeout <ms>` `--json` |
| `inbox` | List messages addressed to an agent | `--agent <id>` `--json` |
| `reply <msg-id> <body>` | Thread a reply to a message | `--json` |
| `watch` | Follow an agent inbox - surface new messages as they arrive | `--agent <id>` `--interval <ms>` `--json` |

All verbs accept `--json` and `--json-envelope`. `watch` applies the envelope per emitted row.
**Exit codes:** `0` success, `1` error, `2` invalid usage.

## `send` - enqueue a message

```bash
spur message send "Please review PR 42" --to reviewer
spur message send "Task 0040 is blocked" --to worker-1 --from operator
spur message send "Done" --to planner --json
spur message send "Review 0042" --to reviewer --wait --until invoke-exit --timeout 30000
spur message send "Start the pass" --role reviewer          # resolves to exactly one instance
```

Enqueues a durable message addressed to `--to <id>`. The recipient drains it on its next `agent run
--drain` or `agent loop` iteration. `--from` defaults to `operator`.

`--wait` snapshots the recipient occupant **before** enqueue, then waits on that pin in the same CLI
process (G4 wave 2 / ADR-057). Default `--until invoke-exit`. A later occupant cannot satisfy the
wait; enqueue is **not** rolled back if the wait later fails.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--to <id>` | Recipient agent id. Mutually exclusive with `--role`; exactly one of the two is required. |
| `--role <name>` | Address by Layer-1 role or executor name. Must resolve to exactly one materialized instance; zero (`count=0`, candidates `none`) or multi (`count=N` + candidates) matches are hard errors (exit 1); unknown name exits 2 naming the accepted vocabulary (`AGENT_ROLE_NAMES` ∪ executor names). Resolution yields the same spec-id path as `--to`; `--wait` snapshots that occupant pin. (0685 R6 / ADR-075 amendment) |
| `--from <id>` | Sender id (default: `operator`). |
| `--wait` | Block until the recipient reaches `--until` (snapshots occupant before send). |
| `--until <state>` | Wait target: `injected` \| `invoke-exit` (repeatable OR). Default `invoke-exit`. |
| `--timeout <ms>` | Caller deadline in milliseconds. |
| `--json` | Output machine-readable JSON (`{ msgId, toId, status, wait: { satisfied } }`). |

`--wait` failures use the same error codes as `agent wait`: `occupant_gone`, `run_replaced`,
`wait_stalled`, `timeout` (exit 1).

## `inbox` - list addressed messages

```bash
spur message inbox --agent worker-1
spur message inbox --agent worker-1 --json
```

Lists messages addressed to `--agent <id>`, oldest first. The body is truncated in plain-text output;
`--json` returns the full body.

## `reply` - thread a reply

```bash
spur message reply msg-003 "Acknowledged - starting now"
spur message reply msg-003 "Done" --json
```

Threads a reply to a specific message id. The reply is addressable to the original sender's inbox.

## `watch` - follow an inbox live

```bash
spur message watch --agent worker-1
spur message watch --agent worker-1 --interval 1000 --json
```

Polls the inbox and surfaces each **new** message exactly once as it arrives. `Ctrl-C` to exit. With
`--json`, emits one JSON object per new message (machine-consumable); without it, prints plain-text
lines.

### Flags

| Flag | Purpose |
| ------ | --------- |
| `--agent <id>` | **Required.** Agent id to watch. |
| `--interval <ms>` | Poll interval in milliseconds (default: `2000`). Must be a positive integer; exit `2` otherwise. |
| `--json` | Output one JSON object per new message. |

## What this skill is NOT

- **Not the agent runner.** `spur agent run --drain` and `spur agent loop` consume the inbox; this
  reference documents the verbs that *populate* it. See **[agent.md](agent.md)**.
- **Not real-time transport.** Messages are durable and polled, not pushed. `watch` simulates
  real-time by polling on an interval.

## See also

- **`spur agent` (see [agent.md](agent.md))** - `run --drain` and `loop` consume the inbox.
- **`spur team` (see [team.md](team.md))** - team lifecycle that assigns agents to tasks.
- **`sp:spur-cli`** SKILL.md - the facade that routes to this reference.

> **Shared option declarations (0618):** options shared across command modules resolve from
> `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`). Never re-declare a shared flag
> inline in a command module — see SKILL.md "Shared option registry" and
> `docs/04_DESIGN.md` §1.0.1.
