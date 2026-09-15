# spur agent

Run and inspect supported coding agents. This is Spur's **single LLM execution surface** — every
model call in Spur (skills, workflow `agent.run` actions, team-mode runs) routes through
`spur agent run`. Spur owns no other path to a model.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents (agent specs with `--specs`) |
| `doctor [agent]` | Check agent readiness |
| `wait [specId]` | Wait for a pinned occupant run to reach a lifecycle state |
| `start <spec-id>` | Start a supervised agent process (requires `spur serve`) |
| `stop <spec-id>` | Stop a supervised agent process (requires `spur serve`) |

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

## Agent specs

`.spur/agents/<id>.yaml` specs are materialized from the fleet declaration when `spur serve`
starts; there is no CLI verb to hand-author them. `spur agent loop` is supervisor-internal
(hidden from `--help`): the supervisor spawns one per started spec.

## See also

- [Daily development workflow](./daily-development-workflow.md) — where agent execution fits
- [message](./message.md) — multi-agent coordination around specs

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: agent.txt + verbs/agent_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
