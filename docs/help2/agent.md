# spur agent

Run and inspect supported coding agents. This is Spur's **single LLM execution surface** — every
model call in Spur (skills, workflow `agent.run` actions, team-mode runs) routes through
`spur agent run`. Spur owns no other path to a model.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents (team agent specs with `--specs`) |
| `doctor [agent]` | Check agent readiness |
| `wait [specId]` | Wait for a pinned occupant run to reach a lifecycle state |
| `loop` | Persistent self-draining loop for a team member (supervisor-managed) |
| `create <id>` | Write a team agent spec to `.spur/agents/<id>.yaml` |
| `edit <id>` | Open an agent spec in `$EDITOR`, or print its path |
| `delete <id>` | Remove an agent spec |

## spur agent run

```bash
spur agent run [options] <prompt>
```

| Flag | Description |
| --- | --- |
| `--agent <name>` | Role, executor, agent binary, `auto`, or `inline` (host-session-only; rejected here) |
| `--spec <id>` | Team agent spec id (occupant addressing; pairs with `--drain`) |
| `--continue` | Resume the previous agent session |
| `--model <name>` | Agent model argument |
| `--mode <mode>` | Agent output mode: `text` \| `json` |
| `--cwd <path>` | Working directory for agent execution |
| `--drain` | Prepend pending inbox messages for `--spec <id>` |
| `--json` | Output machine-readable JSON |

`--agent` resolves in this order: explicit value (role → configured executor → bare binary with a
one-time warning) → `auto` via the `agent` config block (default) → static detection fallback. An
explicit `--model` always wins over the executor's configured model.

Exit codes: `0` success · `1` agent not found or unusable · `2` invalid arguments · `3` execution
failure.

```bash
spur agent run "Add a login endpoint to src/auth/"
spur agent run "Fix the failing test" --agent codex
spur agent run "Continue" --continue
spur agent run "Run the tests" --cwd ./packages/domain
spur agent run "Work on task 0010" --spec reviewer --drain
```

> **Team mode:** `--drain` folds the addressed spec's pending inbox messages into the prompt and
> dispatches with the spec's executor. That is how deferred messages reach a subprocess run,
> which has no live stdin.

## spur agent list

```bash
spur agent list [--specs] [--json]
```

Without flags: detected coding agents. With `--specs`: team agent specs from `.spur/agents/`.

## spur agent doctor

```bash
spur agent doctor [agent] [--probe-health] [--force-refresh] [--json]
```

Readiness check (installed, authenticated, usable). Detection results are cached —
`--force-refresh` bypasses the cache and `--probe-health` opts into live model probing.

## spur agent wait

```bash
spur agent wait [specId] [--role <name>] [--run <runId>] [--until <state>] [--timeout <ms>] [--json]
```

Block until a pinned occupant run reaches a lifecycle state. Address the occupant by spec id
**or** `--role` (mutually exclusive); pin a specific run with `--run`, otherwise the spec's
latest run is used. `--until` is repeatable (OR semantics) and `--timeout` bounds the wait in
milliseconds.

## spur agent loop

```bash
spur agent loop [--spec <id>] [--agent <id>] [--poll <ms>]
```

The persistent self-draining inbox loop for a team member: poll for pending messages
(`--poll <ms>`, default 2000), dispatch each through `agent run`, repeat. `--spec <id>` names
the occupant; `--agent <id>` is the legacy spelling of the same thing. You rarely run this by
hand — the supervisor (`spur serve` + `spur team start`) manages loop processes for started
members.

## spur agent create / edit / delete

```bash
spur agent create <id> --type <agent-type> [--name <name>] [--workspace <path>] [--purpose <text>]
spur agent create <id> [--tags <a,b>] [--model <name>] [--autonomy <level>] [--system-prompt <text>]
spur agent create <id> [--auto-start] [--no-identity-preamble] [--json]
spur agent edit <id>
spur agent delete <id> --force
```

`create` writes `.spur/agents/<id>.yaml` — the team identity card (executor type, purpose, tags,
model, autonomy). `edit` opens it in `$EDITOR` (prints the path when no editor is set). `delete`
**requires** `--force` — no unforced removal.

```bash
spur agent create reviewer --type codex --purpose "Code review specialist" --tags review,quality
spur agent edit reviewer
spur agent delete reviewer --force
```

## See also

- [Daily development workflow](./daily-development-workflow.md) — where agent execution fits
- [team](./team.md) and [message](./message.md) — multi-agent coordination around specs

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: agent.txt + verbs/agent_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
