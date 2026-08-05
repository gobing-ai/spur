# spur agent

> Run and inspect supported coding agents. **This is Spur's single LLM execution surface** —
> every model call in Spur (sp skills, workflow `agent.run` actions, team-mode runs) routes
> through `spur agent run`. Spur owns no other path to a model (it is not a BYOK LLM
> platform — ADR/PRD).

## Subcommands

| Subcommand | Description |
|---|---|
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents; with `--specs`, list team agent specs |
| `doctor [agent]` | Check agent readiness (usable, authenticated, version) |
| `loop` | Persistent self-draining inbox loop for a team member (supervisor-managed) |
| `create <id>` | Write a team agent spec to `.spur/agents/<id>.yaml` |
| `edit <id>` | Open an agent spec in `$EDITOR` (or print its path) |
| `delete <id>` | Remove an agent spec (requires `--force`) |

## spur agent run

```
spur agent run [options] <prompt>
```

| Flag | Description |
|---|---|
| `--agent <name>` | Agent name or `auto` (default: `auto`). Literal `inline` is **rejected** (exit 2) — `spur agent run` always starts a subprocess; use `agent.default` / `--agent auto` / `--agent <name>` for pipeline stages (ADR-046) |
| `--continue` | Resume the previous agent session |
| `--model <name>` | Agent model argument (explicit `--model` wins over the configured one) |
| `--mode <mode>` | Agent output mode: `text` \| `json` (default: `text`) |
| `--cwd <path>` | Working directory for agent execution |
| `--drain` | Prepend pending inbox messages for the `--agent <spec-id>` |
| `--json` | Output machine-readable envelope |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Agent-not-found (or known-but-unusable per phase config) |
| 2 | Invalid arguments (unknown executor per phase config) |
| 3 | Agent execution failure |

### `--agent` resolution

`--agent` (default `auto`) resolves via the `agent` config block:

1. The prompt's slash command yields a **phase** — recognized in every per-agent surface form
   (`/sp:dev-run` claude, `/sp-dev-run` opencode/gemini/hermes/grok, `/skill:sp-dev-run` pi/omp,
   `$sp-dev-run` codex, plus the `rd3` variants → all `dev-run`).
2. A configured `agent.default-by-phase[phase]` selects a named `agent.executors` profile
   (`{ name, agent, model? }`) — its `model` becomes the run's model **unless** the user
   passed an explicit `--model` (explicit wins).
3. A configured phase mapping is **authoritative**: an unknown executor exits 2, a
   known-but-unusable executor exits 1, and neither falls back.
4. With no phase match, `agent.default` is resolved as an executor selector (then a legacy
   agent name); on miss, the static Tier-1 priority resolver picks the first usable Tier-1
   agent — the legacy behavior preserved when no `agent` config is present.
5. `current` reads `SPUR_AGENT` env var; an explicit name resolves directly and never consults
   phase config.

### `--drain` (team mode)

`--drain` resolves the addressed `--agent <id>` as an **agent spec id** (a different namespace
from the coding-agent type), folds that spec's pending inbox messages into the prompt, and
rewrites `--agent` to the spec's underlying type before dispatch. Phase 1-3 has no live stdin,
so prepending is how deferred messages reach the agent.

### Examples

```bash
spur agent run "Add a login endpoint to src/auth/"
spur agent run "Fix the failing test" --agent codex
spur agent run "Continue" --continue
spur agent run "Refactor the DB layer" --agent gemini --model gemini-2.0-flash
spur agent run "Summarize the diff" --agent grok
spur agent run "Generate a summary" --mode json --json
spur agent run "Run the tests" --cwd ./packages/domain
spur agent run "Work on task 0089" --agent reviewer --drain
```

### JSON shape

`--json` emits a machine-readable envelope:

```json
{
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "durationMs": 1234
}
```

## spur agent list

```
spur agent list [options]
```

| Flag | Description |
|---|---|
| `--specs` | List team specs under `.spur/agents/` instead of detected agents |
| `--json` | Output machine-readable JSON |

Detected agents (canonical ids from `ts-ai-runner` `DISPLAY_ORDER`, 0.4.8+): `claude`, `codex`,
`gemini`, `pi`, `omp`, `opencode`, `antigravity-cli`, `openclaw`, `hermes`, `grok`.
(`antigravity` is a deprecated alias of `antigravity-cli`.) Text mode prints
`ok|missing <name> [version]`.

### JSON shape

```json
{
  "agents": [
    { "name": "claude", "installed": true, "version": "2.1.183 (Claude Code)", "channels": [], "error": null }
  ]
}
```

## spur agent doctor

```
spur agent doctor [options] [agent]
```

| Argument | Description |
|---|---|
| `agent` | Single agent to check (omit for all) |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

Readiness check per agent. Text mode prints an aligned table
(`<✓|✗> <usable|missing> <agent> <tier> <auth:yes|no|?> <version>`) with a
`STATUS AGENT TIER AUTH VERSION` header and an `N usable, M missing (tier-1)` footer.
Auth is informational (its own column, not a state label — liveness-only gate, ADR-0127).
**Exit 1 if any tier-1 agent is not usable.** Backed by `ts-ai-runner` `DoctorRunner`.

### JSON shape

```json
{
  "agents": [
    { "agent": "claude", "installed": true, "authenticated": true, "usable": true, "tier": 1, "version": "...", "error": null }
  ]
}
```

## spur agent loop

```
spur agent loop [options]
```

| Flag | Description |
|---|---|
| `--agent <id>` | Agent spec id / message recipient (required for meaningful drain) |
| `--poll <ms>` | Idle poll interval in milliseconds (default `2000`) |

Persistent self-draining inbox loop used by the team supervisor (`spur team up` / `start`).
Each iteration: check the agent inbox → drain pending messages into a prompt → run the agent
→ idle-poll until the next message. Runs until `SIGINT` / `SIGTERM`.

```bash
spur agent loop --agent worker-1
spur agent loop --agent worker-1 --poll 1000
```

## spur agent create

```
spur agent create [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Agent spec id (validated: `[a-z][a-z0-9_-]{1,63}`; duplicates refused) |

| Flag | Description |
|---|---|
| `--type <agent-type>` | Agent spec type (required — any canonical coding-agent id: `claude`/`codex`/`gemini`/`pi`/`omp`/`opencode`/`antigravity-cli`/`openclaw`/`hermes`/`grok`/…) |
| `--name <name>` | Agent name |
| `--workspace <path>` | Workspace path |
| `--purpose <text>` | Team identity purpose (defaults to `"<type> agent"` if empty) |
| `--tags <a,b>` | Comma-separated team identity tags |
| `--model <name>` | Agent model argument |
| `--autonomy <level>` | Autonomy level |
| `--system-prompt <text>` | Team identity system prompt |
| `--no-identity-preamble` | Disable identity preamble |
| `--auto-start` | Auto-start flag |
| `--json` | Output machine-readable JSON |

Writes the spec to `.spur/agents/<id>.yaml`. The id is validated
(`[a-z][a-z0-9_-]{1,63}`); a duplicate id is refused. An empty `--purpose` falls back to
`"<type> agent"` so the written YAML round-trips. `--json` emits `{ ok, spec }`.

### Example

```bash
spur agent create reviewer --type codex --purpose "Code review specialist" --tags review,quality
spur agent create builder --type grok --purpose "Implementation agent"
```

## spur agent edit

```
spur agent edit <id>
```

Opens the spec in `$EDITOR`, or prints its path when `$EDITOR` is unset. Errors if missing.

## spur agent delete

```
spur agent delete [options] <id>
```

| Flag | Description |
|---|---|
| `--force` | Required for delete; the verb refuses (exit 2) without it |

Removes the spec. Errors (exit 1) if missing.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.2 Implementing
- [spur team](./cmd_team.md) — `--drain` integrates with the team coordination
- `docs/04_DESIGN.md` — §1.1 `spur agent` family (canonical surface)
