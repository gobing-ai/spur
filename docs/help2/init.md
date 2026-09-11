# spur init

Initialize Spur in a project: scaffold `.spur/`, seed the global config on first run, and get a
project ready for tasks, rules, and workflows.

## Usage

```bash
spur init [options]
```

## Options

| Flag | Description |
| --- | --- |
| `--name <name>` | Project name (default: current directory name) |
| `--force` | Recreate files that already exist |
| `--minimal` | Only write the minimal `.spur` scaffold |
| `--adopt-global-config` | Also rewrite `~/.config/spur/config.yaml` from the shipped global default (backed up first) |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## What it creates

| Path | Purpose |
| --- | --- |
| `.spur/config.yaml` | Project config (single config surface) |
| `~/.config/spur/config.yaml` | Global user config (seeded from the bundled `config.example.yaml` on first run; never overwritten once it exists) |
| `.spur/agents/` | Team agent specs directory |
| `.spur/rules/` | Constraint rule presets (project layer) |
| `.spur/tasks/` | Task corpus directory (planning/feature/task files) |
| `.spur/workflows/` | Project workflow YAML layer (not created by `init` — shipped pipelines resolve from the package's `bundled:workflows` config layer) |
| `.spur/spur.db` | SQLite database: run history, traces, planning events (WAL mode) |
| `.spur/logs/spur.log` | Log output |

## Behavior and gotchas

- **Re-init guard:** `init` refuses (exit 1) when `.spur/config.yaml` already exists unless you
  pass `--force` — a stray init cannot clobber a configured project.
- **Global seed:** the first run seeds `~/.config/spur/` from bundled defaults; existing files
  are never overwritten. `--adopt-global-config` is the explicit opt-in to replace the global
  config (with a backup).
- `--minimal` still creates the `.spur/agents/` directory.

## Verify

```bash
spur status          # project: ok, .spur: ok, git branch, agent specs
```

## See also

- [Getting started](./getting-started.md) — install and first run
- [status](./status.md) — health check

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: init.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
