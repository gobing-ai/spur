# spur agent

> Run and inspect supported coding agents. This is Spur's single LLM execution surface.

## Subcommands

| Subcommand | Description |
|---|---|
| `run <prompt>` | Execute a prompt or slash command via a coding agent |
| `list` | List detected coding agents, or team agent specs with `--specs` |
| `doctor [agent]` | Check agent readiness |
| `create <id>` | Write a team agent spec to `.spur/agents/<id>.yaml` |
| `edit <id>` | Open an agent spec in `$EDITOR`, or print its path |
| `delete <id>` | Remove an agent spec |

## spur agent run

```
spur agent run [options] <prompt>
```

| Flag | Description |
|---|---|
| `--agent <name>` | Agent name, current, or auto |
| `--continue` | Resume the previous agent session |
| `--model <name>` | Agent model argument |
| `--mode <mode>` | Agent output mode: `text` \| `json` |
| `--cwd <path>` | Working directory for agent execution |
| `--json` | Output machine-readable JSON where supported |
| `--drain` | Prepend pending inbox messages for `--agent <id>` |

### Examples

```bash
spur agent run "Add a login endpoint to src/auth/"
spur agent run "Fix the failing test" --agent codex
spur agent run "Continue" --continue
spur agent run "Refactor the DB layer" --agent gemini --model gemini-2.0-flash
spur agent run "Generate a summary" --mode json --json
spur agent run "Run the tests" --cwd ./packages/domain
spur agent run "Work on task 0089" --agent reviewer --drain
```

> **Single LLM execution surface:** every model call in Spur routes through `spur agent run`.
> Workflow `agent.run` actions and sp skills all delegate to this same command.

## spur agent list

```
spur agent list [options]
```

| Flag | Description |
|---|---|
| `--specs` | List team specs instead of detected agents |
| `--json` | Output machine-readable JSON |

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
| `agent` | Agent to check (omit for all) |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

### JSON shape

```json
{
  "agents": [
    { "agent": "claude", "installed": true, "authenticated": true, "usable": true, "tier": 1, "version": "...", "error": null }
  ]
}
```

### Verified agent detection (2026-06-19)

| Agent | Version | Authenticated | Usable |
|---|---|---|---|
| claude | 2.1.183 | ✓ | ✓ |
| codex | 0.140.0 | ✓ | ✓ |
| gemini | 0.42.0 | ✓ | ✓ |
| pi | 0.78.0 | ✓ | ✓ |
| opencode | 1.1.25 | ✗ | ✗ |
| antigravity | 1.0.9 | ✗ | ✗ |
| openclaw | 2026.3.2 | ✗ | ✗ |

## spur agent create

```
spur agent create [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Agent spec id |

| Flag | Description |
|---|---|
| `--type <agent-type>` | Agent spec type for create |
| `--tags <a,b>` | Team identity tags |
| `--system-prompt <text>` | Team identity system prompt |
| `--name <name>` | Agent name |
| `--workspace <path>` | Workspace path |
| `--purpose <text>` | Team identity purpose |
| `--auto-start` | Auto-start flag |
| `--model <name>` | Agent model argument |
| `--autonomy <level>` | Autonomy level |
| `--no-identity-preamble` | Disable identity preamble |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur agent create reviewer --type codex --purpose "Code review specialist" --tags review,quality
```

> **Team mode (Phase 1–3):** `team assign` + `message send` + `agent run --drain <spec-id>`
> folds the spec's inbox into the prompt and maps spec-id → coding-agent type.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.2 Implementing
- `docs/04_DESIGN.md` — §agent run surface
