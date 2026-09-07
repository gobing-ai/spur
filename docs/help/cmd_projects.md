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

## spur projects add

```
spur projects add [options] <path>
```

| Argument | Description |
|---|---|
| `path` | Project root to register |

| Flag | Description |
|---|---|
| `--name <name>` | Display name for the project |
| `--json` | Output JSON response |

## spur projects remove

```
spur projects remove [options] <target>
```

| Argument | Description |
|---|---|
| `target` | Display name or path of the project to remove |

| Flag | Description |
|---|---|
| `--json` | Output JSON response |

## spur projects list

```
spur projects list [options]
```

| Flag | Description |
|---|---|
| `--json` | Output JSON array of projects |

## spur projects start

```
spur projects start [options] <target>
```

| Argument | Description |
|---|---|
| `target` | Display name or path of the project whose server to start |

| Flag | Description |
|---|---|
| `--port <n>` | Explicit port to bind |
| `--json` | Output JSON response |

## spur projects stop

```
spur projects stop [options] <target>
```

| Argument | Description |
|---|---|
| `target` | Display name or path of the project whose server to stop |

| Flag | Description |
|---|---|
| `--json` | Output JSON response |

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
