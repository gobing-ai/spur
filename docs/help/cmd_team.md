# spur team

> Coordinate team-agent assignments and supervision. Sits above `spur agent` specs:
> `up` / `down` materialize and tear down rosters, `start` / `stop` manage supervised
> processes (require `spur serve`), `assign` wires tasks to agents, and `status` reports
> membership and live run state when the supervisor API is reachable.

## Subcommands

| Subcommand | Description |
|---|---|
| `assign <task-id> <agent-id>` | Set `assignee: <agent-id>` on a task file's YAML frontmatter |
| `status` | List agent specs and their run status; `--by-team` groups by team |
| `up <team>` | Materialize a team roster into specs; best-effort start when serve is up |
| `down <team>` | Tear down a team (stop members); `--purge` removes generated specs |
| `start <agent-id>` | Start a supervised agent process (requires `spur serve`) |
| `stop <agent-id>` | Stop a supervised agent process (requires `spur serve`) |

Default supervisor URL: `http://localhost:3000/api` (override with `--server <url>`).

## spur team assign

```
spur team assign <task-id> <agent-id>
```

| Argument | Description |
|---|---|
| `task-id` | Task file id (resolves via `spur task resolve`) |
| `agent-id` | Agent spec id (under `.spur/agents/`) |

Set the `assignee:` field on the matching task file's YAML frontmatter (replacing any existing
assignee). Errors if no matching task file is found. Prints `assigned <task-id> → <agent-id>`
on success.

### Example

```bash
spur team assign 0042 reviewer
spur team assign 0089 tester
```

## spur team status

```
spur team status [options]
```

| Flag | Description |
|---|---|
| `--by-team` | Group specs by their `agent.team.<id>` membership |
| `--server <url>` | Supervisor API URL for live run status |
| `--json` | Output machine-readable JSON |

Lists specs under `.spur/agents/` with run status from the supervisor when reachable;
otherwise falls back to local spec metadata.

```bash
spur team status
spur team status --by-team --json
```

## spur team up

```
spur team up [options] <team>
```

| Argument | Description |
|---|---|
| `team` | Team id (`agent.team.<team>`) |

| Flag | Description |
|---|---|
| `--check` | Dry-run: show the add/prune diff without writing |
| `--server <url>` | Supervisor API URL |
| `--json` | Output machine-readable JSON |

Materialize a team roster into agent specs. When `spur serve` is reachable, best-effort
starts each member.

```bash
spur team up alpha
spur team up alpha --check
```

## spur team down

```
spur team down [options] <team>
```

| Argument | Description |
|---|---|
| `team` | Team id |

| Flag | Description |
|---|---|
| `--purge` | Also delete `spur:generated` specs (never manual / `ref:`) |
| `--server <url>` | Supervisor API URL |
| `--json` | Output machine-readable JSON |

Stop all members of `<team>`. `--purge` fully cleans up generated roster specs.

## spur team start | stop

```
spur team start [options] <agent-id>
spur team stop [options] <agent-id>
```

| Flag | Description |
|---|---|
| `--server <url>` | Supervisor API URL |
| `--json` | Output machine-readable JSON |

Start or stop a supervised agent process. Requires `spur serve` (or an equivalent
supervisor at `--server`).

```bash
spur team start worker-1
spur team stop worker-1 --json
```

## See Also

- [spur message](./cmd_message.md) — durable inter-agent messaging and the drain mechanism
- [spur agent](./cmd_agent.md) — agent specs (`create`/`edit`/`delete`), `loop`, and `--drain`
- [spur serve](./cmd_serve.md) — local web server + supervisor API
