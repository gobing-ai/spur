# spur projects

> Multi-project registry: register project roots and start/stop their Spur Board servers.

## Subcommands

| Subcommand | Description |
|---|---|
| `add <path>` | Register a project root (`--name` sets the display name) |
| `remove <target>` | Remove a project by display name or path (`--host` scopes to one host's entry) |
| `list` | List registered projects |
| `start <target>` | Start a project's server (`--port <n>` to bind explicitly) |
| `stop <target>` | Stop a project's server (local entries only; remote entries are refused) |
| `clean` | Purge missing project directories and terminate lingering processes |

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
| `--host <host>` | Host for a local or remote project (default: `localhost`) |
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
| `--host <host>` | Remove only the entry registered for this host; a path can be registered for a remote host and for `localhost` |
| `--json` | Output JSON response |

## spur projects list

```
spur projects list [options]
```

| Flag | Description |
|---|---|
| `--json` | Output JSON array of projects |
| `--fleet` | Also resolve each project's `agent.fleet` declaration (0858), orchestrator binding state (0836), and persisted strategy (0838) |

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

A remote entry (`--host` other than `localhost`) is refused: this CLI cannot verify or signal
another machine's serve, so it never clears that entry's port.

| Flag | Description |
|---|---|
| `--json` | Output JSON response |

## spur projects clean

```
spur projects clean [options]
```

| Flag | Description |
|---|---|
| `--no-terminate-processes` | Skip process termination on occupied ports |
| `--json` | Output JSON response |

## Example

```bash
spur projects add ~/xprojects/spur-new --name spur
spur projects add /srv/kk --host 192.168.87.27 --name kk
spur projects list --json
spur projects start spur --port 3100
spur projects stop spur
spur projects remove kk --host localhost   # drop a stale local row, keep the remote one
```

## See Also

- [Command index](./index.md)
- [cmd_serve.md](./cmd_serve.md) — the single-project server `projects start/stop` manage per registry entry
