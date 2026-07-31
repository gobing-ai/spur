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
| `send <body>` | Enqueue a message for an agent | `--to <id>` `--from <id>` `--json` |
| `inbox` | List messages addressed to an agent | `--agent <id>` `--json` |
| `reply <msg-id> <body>` | Thread a reply to a message | `--json` |
| `watch` | Follow an agent inbox - surface new messages as they arrive | `--agent <id>` `--interval <ms>` `--json` |

All verbs accept `--json` for machine consumption. **Exit codes:** `0` success, `1` error, `2`
invalid usage.

## `send` - enqueue a message

```bash
spur message send "Please review PR 42" --to reviewer
spur message send "Task 0040 is blocked" --to worker-1 --from operator
spur message send "Done" --to planner --json
```

Enqueues a durable message addressed to `--to <id>`. The recipient drains it on its next `agent run
--drain` or `agent loop` iteration. `--from` defaults to `operator`.

### Flags

| Flag | Purpose |
|------|---------|
| `--to <id>` | **Required.** Recipient agent id. |
| `--from <id>` | Sender id (default: `operator`). |
| `--json` | Output machine-readable JSON. |

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
|------|---------|
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
