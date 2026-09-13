# spur message

> Send, list, and reply to durable inter-agent messages. Backs team coordination. Messages
> persist in the SQLite `inbox_messages` table (backed by `TeamService` →
> `ts-ai-runner` `MessageService` → `ts-db` `InboxMessageDao`).

## Subcommands

| Subcommand | Description |
|---|---|
| `send <body>` | Enqueue a message for an agent |
| `inbox` | List messages addressed to an agent |
| `reply <msg-id> <body>` | Thread a reply to a message |
| `watch` | Follow an agent inbox — surface new messages as they arrive |

## spur message send

```
spur message send [options] <body>
```

| Argument | Description |
|---|---|
| `body` | Message body |

| Flag | Default | Description |
|---|---|---|
| `--to <id>` | — | Recipient agent id (required unless `--role`) |
| `--from <id>` | `operator` | Sender id |
| `--role <name>` | — | Address by Layer-1 role or executor name; must resolve to exactly one materialized instance |
| `--request-key <key>` | — | Caller-minted idempotency key. The same key with the same body + recipient replays the original receipt (`replayed: true`; no second row or delivery); the same key with a different payload fails with a request-key-conflict error (0832) |
| `--wait` | — | Block until the recipient occupant reaches `--until` (snapshots occupant **before** enqueue) |
| `--until <state>` | `invoke-exit` | Wait target when `--wait` is set: `injected` \| `invoke-exit` (repeatable OR) |
| `--timeout <ms>` | — | Caller deadline for `--wait` |
| `--json` | — | Output machine-readable JSON |

Keyed JSON receipts include `requestKey` and `replayed`; blank request keys are rejected.

`--wait` snapshots the occupant **before** `send`, then waits on that pin in the same process
(G4 wave 2). A later occupant cannot satisfy the wait; enqueue is **not** rolled back if the
wait later fails. Failures use the same `{ error: { code, message } }` envelope as
`spur agent wait` (`occupant_gone` / `run_replaced` / `wait_stalled` / `timeout`, exit 1).

### Example

```bash
spur message send "Please review the auth endpoint" --to reviewer
spur message send "Urgent: tests failing" --to reviewer --from operator
spur message send "Review 0042" --to reviewer --wait --until invoke-exit --timeout 30000
```

### JSON shape

```json
{
  "msgId": "826b838a-...",
  "toId": "reviewer",
  "status": "queued",
  "injected": false
}
```

## spur message inbox

```
spur message inbox --agent <id> [--unresolved] [--json]
```

| Flag | Description |
|---|---|
| `--agent <id>` | Agent id whose inbox to list (required) |
| `--unresolved` | Only messages the delivery reconciler holds (0834): `delivery-failed` \| `attempts-exhausted` \| `outcome-unknown` \| `run-exit-only` |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur message inbox --agent reviewer
spur message inbox --agent reviewer --json
```

### JSON shape

```json
{
  "messages": [
    {
      "id": "826b838a-...",
      "fromId": "operator",
      "body": "Please review the auth endpoint",
      "status": "queued",
      "createdAt": "2026-06-19T05:42:00.577Z",
      "inReplyTo": null,
      "injectAttempts": 1,
      "injectError": null,
      "reason": "outcome-unknown",
      "runId": "run-abc",
      "taskId": "task-9",
      "runStatus": "running",
      "artifacts": [{ "kind": "result", "path": "/tmp/x.json" }]
    }
  ],
  "count": 1
}
```

`injectAttempts`/`injectError` are the delivery attempt count and last error (0831). `reason`,
`runId`, `taskId`, and `artifacts` are present when the 0834 delivery reconciler classifies the row
(with `--json` or `--unresolved`); `artifacts` is always an array. `--unresolved` runs the
reconciler first, so an over-budget `queued` row is reported (and marked) `attempts-exhausted`
without requeue.

## spur message reply

```
spur message reply [options] <msg-id> <body>
```

| Argument | Description |
|---|---|
| `msg-id` | Message id to reply to |
| `body` | Reply body |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

Looks up the original message, addresses the reply back to its `from_id`, and threads it via
`in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with
no peer.

### Example

```bash
spur message reply msg-001 "Looks good, merging"
```

## spur message watch

```
spur message watch [options]
```

| Flag | Description |
|---|---|
| `--agent <id>` | Agent id whose inbox to watch (required) |
| `--interval <ms>` | Poll interval in milliseconds (default 2000) |
| `--json` | Emit one JSON object per new message (machine-consumable by agent wrappers) |

Follows an agent's inbox and surfaces each new message exactly once as it arrives. Polls the
store directly via `TeamService` — no server required (serverless is the contract; SSE-follow
when `spur serve` is up is a future optimization). `Ctrl-C` exits cleanly.

**Watch SURFACES, it never CONSUMES** — it does not mark messages read/delivered. Read-marking
stays with `--drain` / explicit reads, which makes `watch` safe to run alongside a drain loop.

### Example

```bash
# Terminal 1: an agent session watches its inbox
spur message watch --agent planner --json

# Terminal 2: another agent drops a message in
spur message send "Plan ready for review" --to planner
```

## Team Mode

Team mode (Phase 1–3) uses **prepend-on-drain**: `task update --assignee` (0848: the moved home of
`team assign`) + `message send` +
`agent run --drain <spec-id>` folds the spec's inbox into the prompt and maps spec-id →
coding-agent type. There are no live daemons; `--drain` is the coordination mechanism. See
[spur task](./cmd_task.md) and [spur team](./cmd_team.md).

## See Also

- [spur task](./cmd_task.md) — `task update --assignee` assigns tasks to agent specs.
- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.6 Team Coordination
