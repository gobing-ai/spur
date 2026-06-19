# spur message

> Send and inspect durable inter-agent messages. Backs team coordination.

## Subcommands

| Subcommand | Description |
|---|---|
| `send <body>` | Enqueue a message for an agent |
| `inbox` | List messages addressed to an agent |
| `reply <msg-id> <body>` | Thread a reply to a message |

## spur message send

```
spur message send [options] <body>
```

| Argument | Description |
|---|---|
| `body` | Message body |

| Flag | Default | Description |
|---|---|---|
| `--to <id>` | — | Recipient agent id |
| `--from <id>` | `operator` | Sender id |
| `--json` | — | Output machine-readable JSON |

### Example

```bash
spur message send "Please review the auth endpoint" --to reviewer
spur message send "Urgent: tests failing" --to reviewer --from operator
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
spur message inbox [options]
```

| Flag | Description |
|---|---|
| `--agent <id>` | Agent id |
| `--json` | Output machine-readable JSON |

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
      "inReplyTo": null
    }
  ],
  "count": 1
}
```

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

### Example

```bash
spur message reply msg-001 "Looks good, merging"
```

## Team Mode

Team mode (Phase 1–3) uses prepend-on-drain: `team assign` + `message send` +
`agent run --drain <spec-id>` folds the spec's inbox into the prompt and maps spec-id →
coding-agent type. There are no live daemons; `--drain` is the coordination mechanism.

## See Also

- [spur team](./cmd_agent.md) — agent spec management
- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.6 Team Coordination
