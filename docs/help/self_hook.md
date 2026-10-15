# spur self hook

> Host hook transport. Reads one host hook payload on stdin and prints the host-shaped decision,
> always exiting 0 (fail-open). `superskill hook run sp <id>` and the Pi extension will route through it once wired (later PR);
> you rarely run it by hand except to debug a hook.
>
> **Placement:** `self hook` sits under the `self` noun (owner decision Q1 in
> `docs/plans/2026-10-14-spur-script-absorption.md`). It is dispatched before the database and
> configuration boot, so it never creates `.spur/spur.db` and never fails on a broken config.

## Usage

```
spur self hook <id> [--host <host>]
spur self hook list [--json]
```

## Hook ids

| Id | Kind | Host events | Output |
|---|---|---|---|
| `task-write-guard` | guard | PreToolUse `Write\|Edit` (Pi `tool_call` write/edit) | `deny` for a spur-owned task file, else `allow` |
| `careful-guard` | guard | PreToolUse `Bash`, opt-in (Pi `tool_call` bash) | `ask` for a destructive command, else `allow` |
| `context-post-tool` | capture | PostToolUse (Pi `tool_result`) | none; appends to `.spur/context/token-ledger.jsonl` |
| `context-session-start` | capture | SessionStart (Pi `session_start`) | none; opens or reuses the ledger session |
| `context-session-stop` | capture | SessionEnd (Pi `session_shutdown`) | none; finalizes the owned session |
| `agent-lifecycle` | lifecycle | SessionStart, UserPromptSubmit, Notification(permission_prompt), Stop (Pi `agent_start`/`agent_settled`) | none; detached `spur agent report` inside a fleet |
| `fleet-guest-stop` | delivery | Stop | `{"decision":"block",…}` when a joined guest has queued mail |

## Options

| Flag | Default | Description |
|---|---|---|
| `--host <host>` | `auto` | Payload and output shape: `claude`, `codex`, `pi` or `auto` (`claude` when `CLAUDE_PROJECT_DIR` is set, else `codex`; both share one wire format). `pi` takes a raw Pi event (`{toolName, input, content, sessionId, event}`) and guards reply `{"action":"allow"\|"deny"\|"ask","reason"?}` |
| `--json` | — | With `list`: print the hook registry as JSON |

`SPUR_WRITE_GUARD=off` and `SPUR_CAREFUL=off` disable the two guards. Hooks that call the CLI
(`task-write-guard`, `agent-lifecycle`, `fleet-guest-stop`) use `SPUR_BIN` when set, otherwise the
same `spur` build that is running the hook.

## Examples

```bash
spur self hook list
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | spur self hook careful-guard
echo '{"toolName":"bash","input":{"command":"rm -rf /"}}' | spur self hook careful-guard --host pi
spur self hook list --json
```
