# spur team

> **Deprecated (0848, feature G64) — use the owning nouns.** Every verb below still runs and emits a
> one-time stderr warning; the noun is removed once no caller remains. Replacements:
>
> | Old verb | New home |
> | --- | --- |
> | `assign <task-id> <agent-id>` | `spur task update <wbs> --assignee <spec-id>` |
> | `status` | `spur agent list --specs` |
> | `status --by-team` | dropped — one project has one fleet |
> | `up <team>` | fleet materialization at `spur serve` start (`.spur/fleet.json`); `--check` → `spur projects list --fleet` |
> | `down <team> [--purge]` | `spur agent stop <spec-id>` per member (`spur agent delete <id>` replaces `--purge`) |
> | `start <agent-id>` / `stop <agent-id>` | `spur agent start <spec-id>` / `spur agent stop <spec-id>` |

Coordinate team agent assignments and status: materialize rosters into agent specs, assign tasks,
and manage supervised agent processes (supervised processes need `spur serve`).

## Subcommands

| Subcommand | Description |
| --- | --- |
| `assign <task-id> <agent-id>` | Set the assignee on a task file |
| `status` | List agent specs and their run status (`--by-team` groups by team) |
| `up <team>` | Materialize a team roster into agent specs; best-effort start when serve is reachable |
| `down <team>` | Tear down a team: stop members; `--purge` also removes generated specs |
| `start <agent-id>` | Start a supervised agent process (requires `spur serve`) |
| `stop <agent-id>` | Stop a supervised agent process (requires `spur serve`) |

## spur team assign

```bash
spur team assign <task-id> <agent-id>
```

Sets the assignee on a task file — the record of who owns a task.

```bash
spur team assign 0010 reviewer
```

## spur team status

```bash
spur team status [--by-team] [--server <url>] [--json]
```

Lists agent specs and their run status. `--by-team` groups specs by team membership; `--server`
points at the live-status API (default: `http://localhost:3000/api`).

## spur team up / down

```bash
spur team up <team> [--check] [--server <url>] [--json]
spur team down <team> [--purge] [--server <url>] [--json]
```

`up` materializes a team roster (declared as `agent.team.<id>` membership in agent specs) into
concrete specs — `--check` previews the add/prune diff without writing. `down` stops members;
`--purge` also deletes generated specs (manually authored specs are never removed).

```bash
spur team up platform --check     # preview
spur team up platform             # materialize (and best-effort start)
spur team down platform           # stop members
spur team down platform --purge   # stop and remove generated specs
```

## spur team start / stop

```bash
spur team start <agent-id> [--server <url>] [--json]
spur team stop <agent-id> [--server <url>] [--json]
```

Supervised processes: each started member runs its persistent self-draining loop under the
`spur serve` supervisor. **Requires a reachable serve instance** — without one, use
`spur agent run --spec <id> --drain` for store-and-forward dispatch.

## See also

- [agent](./agent.md) — spec creation (`agent create`), occupant runs, `--drain`
- [message](./message.md) — the durable inbox each member drains

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: team.txt + verbs/team_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
