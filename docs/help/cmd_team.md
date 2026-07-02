# spur team

> Coordinate team-agent assignments and status. Team mode (Phase 1–3) uses **prepend-on-drain**;
> `start` / `stop` are **Phase-4 stubs** (no live daemons yet) that print a
> `daemon-not-available` message and exit 0.

## Subcommands

| Subcommand | Description |
|---|---|
| `assign <task-id> <agent-id>` | Set `assignee: <agent-id>` on a task file's YAML frontmatter |
| `status` | List agent specs and their run status |
| `start` | **Phase-4 stub** — prints `daemon-not-available` message, exits 0 |
| `stop` | **Phase-4 stub** — prints `daemon-not-available` message, exits 0 |

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
spur team assign 0089 tester   # multiple assignments are allowed (one spec per task)
```

## spur team status

```
spur team status [--json]
```

Lists every spec under `.spur/agents/` with its run status (`stopped` in Phase 1-3, since
no daemon exists yet). `--json` emits `{ agents: [...] }`.

## spur team start | stop

```
spur team start
spur team stop
```

> **Phase-4 stubs.** No live daemons exist today; coordination runs through
> `team assign` + `message send` + `agent run --drain <spec-id>` (prepend-on-drain). Both stubs
> print `Team daemon not yet available. Use spur agent run --drain for deferred message delivery.`
> and exit 0.

## See Also

- [spur message](./cmd_message.md) — durable inter-agent messaging and the drain mechanism.
- [spur agent](./cmd_agent.md) — agent spec management (`create`/`edit`/`delete`) and the
  `--drain` flag that folds the spec's inbox into the prompt.
