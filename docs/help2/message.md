# spur message

Send and inspect durable inter-agent messages. Messages persist in the project database, so an
agent that is not running right now still receives them — senders and receivers are decoupled.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `send <body>` | Enqueue a message for an agent (`--wait` blocks until a state) |
| `inbox` | List messages addressed to an agent |
| `reply <msg-id> <body>` | Thread a reply to a message |
| `watch` | Follow an agent inbox, surfacing new messages as they arrive |

## spur message send

```bash
spur message send <body> --to <id> [--from <id>] [--json]
spur message send <body> --to <id> --wait [--until <state>] [--timeout <ms>]
spur message send <body> --role <name> [--json]
```

| Flag | Description |
| --- | --- |
| `--to <id>` | Recipient agent id (mutually exclusive with `--role`) |
| `--role <name>` | Address by role or executor name; must resolve to exactly one instance |
| `--from <id>` | Sender id (default: `operator`) |
| `--wait` | Block until the recipient reaches the `--until` state (default: `invoke-exit`) |
| `--until <state>` | Wait target: `injected` \| `invoke-exit` |
| `--timeout <ms>` | Caller deadline in milliseconds |

```bash
spur message send "Please review the auth endpoint" --to reviewer
spur message send "Urgent: tests failing" --to reviewer --from operator
spur message send "Build the report" --to builder --wait --timeout 60000
```

> **Delivery semantics:** `send` enqueues; it does not run the recipient. Pair with
> `spur agent run --spec <id> --drain` (store-and-forward) or a supervised member
> (`spur team start`) for actual dispatch. `--wait --until injected` returns once the message is
> folded into a run; `invoke-exit` waits for the run to exit.

## spur message inbox / reply / watch

```bash
spur message inbox --agent <id> [--json]
spur message reply <msg-id> <body> [--json]
spur message watch --agent <id> [--interval <ms>] [--json]
```

`inbox` lists what an agent has received. `reply` threads a conversation onto a message.
`watch` polls an inbox (default every 2000 ms) and prints new messages as they arrive — the
session-side half of team coordination (Ctrl-C to exit). With `--json`, each new message is one
JSON object, suitable for machine consumption.

```bash
spur message inbox --agent reviewer
spur message reply msg-001 "Looks good, merging"
spur message watch --agent reviewer
```

## See also

- [team](./team.md) — rosters, assignment, supervised processes
- [agent](./agent.md) — `agent run --spec --drain` consumes the inbox

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: message.txt + verbs/message_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
