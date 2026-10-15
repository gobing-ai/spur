# spur self hook

Run one host hook: read the hook payload on stdin, print the host-shaped decision, exit 0.
Transport that `superskill hook run sp <id>` and the Pi extension will route through (wiring lands later); use it by hand to debug a hook.

## Usage

```bash
spur self hook <id> [--host <host>]
spur self hook list [--json]
```

Ids: `task-write-guard`, `careful-guard`, `context-post-tool`, `context-session-start`,
`context-session-stop`, `agent-lifecycle`, `fleet-guest-stop`.

## Options

| Flag | Description |
| --- | --- |
| `--host <host>` | `claude`, `codex`, `pi` or `auto` (default). `pi` reads a raw Pi event and guards reply `{"action":…}` |
| `--json` | With `list`: machine-readable registry |

## Examples

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | spur self hook careful-guard
spur self hook list --json
```

See [docs/help/self_hook.md](../help/self_hook.md) for the full id table and environment switches.
