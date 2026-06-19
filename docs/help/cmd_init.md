# spur init

> Scaffold a local Spur project. Creates `.spur/` with config, rules, and workflows.

## Usage

```
spur init [options]
```

## Options

| Flag | Description |
|---|---|
| `--name <name>` | Project name (default: current directory name) |
| `--force` | Recreate files that already exist |
| `--minimal` | Only write the minimal `.spur` scaffold (no rules/workflows) |
| `--json` | Output machine-readable JSON |

## What It Creates

Under `.spur/`:

| Path | Purpose |
|---|---|
| `config.yaml` | Project config (tasks folders, features dir) |
| `config.json` | Machine-readable config mirror |
| `rules/` | Constraint rule presets (symlinked to repo `config/rules/`) |
| `workflows/` | Workflow YAML definitions (symlinked to repo `config/workflows/`) |
| `spur.db` | SQLite database for run history, traces, planning events (WAL mode) |

## Examples

```bash
spur init                        # scaffold with defaults
spur init --name my-project      # custom project name
spur init --minimal              # minimal scaffold only
spur init --force                # recreate existing files
spur init --json                 # machine-readable output
```

## Verification

```bash
spur status   # should show "Project: ok, .spur: ok"
```

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §3 Project Initialization
- `docs/04_DESIGN.md` — §2.1 init surface
