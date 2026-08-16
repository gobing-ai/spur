# spur projects

> Multi-project registry: register project roots and start/stop their Spur Board servers.

## Subcommands

| Subcommand | Description |
|---|---|
| `add <path>` | Register a project root (`--name` sets the display name) |
| `remove <target>` | Remove a project by display name or path |
| `list` | List registered projects |
| `start <target>` | Start a project's server (`--port <n>` to bind explicitly) |
| `stop <target>` | Stop a project's server |

All verbs accept `--json` for machine-readable output.

## Example

```bash
spur projects add ~/xprojects/spur-new --name spur
spur projects list --json
spur projects start spur --port 3100
spur projects stop spur
```

## See Also

- [Command index](./index.md)
- [cmd_serve.md](./cmd_serve.md) — the single-project server `projects start/stop` manage per registry entry
