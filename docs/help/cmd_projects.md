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
| `migrate [path]` | Preview (default) or apply the legacy `agent.team` → `fleet.json` conversion |

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
| `--fleet` | Also resolve each project's .spur/fleet.json declaration (0835), orchestrator binding state (0836), and persisted strategy (0838) |

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

## spur projects migrate

```
spur projects migrate [options] [path]
```

Legacy G64 cutover: converts the single `agent.team.<id>` roster resolving to `path`
into `.spur/fleet.json` with every spec id preserved verbatim. Dry-run by default;
refuses to write on any reported conflict. Additive only — specs, `config.yaml`, and
the database are never modified.

| Argument | Description |
|---|---|
| `path` | Project root directory path (default: current directory) |

| Flag | Description |
|---|---|
| `--dry-run` | Preview the conversion; nothing is written (the default — `--apply` writes) |
| `--apply` | Write the conversion: back up any prior fleet.json to .bak, then write the declaration (default is dry-run) |
| `--json` | Output machine-readable JSON |

Exit codes: 0 on success (preview or converted/unchanged/nothing-to-convert); 2 when
conflicts block the run (the payload still carries the full plan/result); 1 on error.

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
