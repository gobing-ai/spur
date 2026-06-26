# spur team

> Coordinate team-agent assignments and status. Team mode (Phase 1–3) uses prepend-on-drain;
> `start`/`stop` are Phase-4 stubs (no live daemons yet).

## Subcommands

| Subcommand | Description |
|---|---|
| `assign <task-id> <agent-id>` | Assign a task to a team agent spec |
| `status` | Show current team assignments and agent status |
| `start` | Start team-mode coordination (Phase-4 stub) |
| `stop` | Stop team-mode coordination (Phase-4 stub) |

## spur team assign

```
spur team assign [options] <task-id> <agent-id>
```

| Argument | Description |
|---|---|
| `task-id` | Task file id |
| `agent-id` | Agent spec id (under `.spur/agents/`) |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

### Example

```bash
spur team assign 0042 reviewer
```

## spur team status

```
spur team status [--json]
```

Lists current assignments and per-agent status.

## spur team start | stop

```
spur team start
spur team stop
```

> **Phase-4 stubs.** No live daemons exist today; coordination runs through
> `team assign` + `message send` + `agent run --drain <spec-id>` (prepend-on-drain). See
> [spur message → Team Mode](./cmd_message.md).

## See Also

- [spur message](./cmd_message.md) — durable inter-agent messaging and the drain mechanism.
- [spur agent](./cmd_agent.md) — agent spec management (`create`/`edit`/`delete`).
