# spur init

> Scaffold a local Spur project. Writes `.spur/config.yaml` and, unless `--minimal`, scaffolds
> `.spur/rules/` (with the `recommended-pre-check` + `recommended-post-check` presets) and
> `.spur/workflows/basic.yaml` from the bundled config assets. Always creates `.spur/agents/`
> (with a `.gitkeep`) for team-mode agent specs, regardless of `--minimal`. On first run it
> seeds `~/.config/spur/` from the bundled package-root `config/` assets so `spur rule run` resolves
> a real ruleset from any project.
>
> **Canonical path:** `spur self init`. The legacy `spur init` top-level form remains a hidden alias
> over the same command — it keeps working unchanged for existing scripts and workflow YAML but is
> absent from `spur --help`.

## Usage

```
spur init [options]
```

## Options

| Flag | Description |
|---|---|
| `--name <name>` | Project name (default: current directory name) |
| `--force` | Recreate files that already exist (refused otherwise — see "Re-init guard") |
| `--minimal` | Only write the minimal `.spur` scaffold (no rules, no workflows) |
| `--json` | Output machine-readable JSON |

## What It Creates

Under `.spur/`:

| Path | Purpose |
|---|---|
| `config.yaml` | Project config (single surface, ADR-017 — supersedes the legacy `config.json`) |
| `agents/.gitkeep` | Team-mode agent specs dir — created regardless of `--minimal` |
| `rules/` | Constraint rule presets (project layer, populated from bundled assets) |
| `workflows/basic.yaml` | Canonical implement/check/fix loop — entry point for `spur workflow run` |
| `spur.db` | SQLite database for run history, traces, planning events (WAL mode) |
| `logs/spur.log` | Bootstrap logger output (path from `bootstrap.logging.filePath`) |

> **Single config surface.** Per ADR-017, `spur init` writes **only** `.spur/config.yaml`. The
> legacy `.spur/config.json` project marker is retired; the bootstrap block is folded into the
> same YAML (consumed by `@gobing-ai/ts-infra` `runNodeApplication`).

The scaffolded files are an explicit reviewed manifest (`SCAFFOLD_MANIFEST` in
`apps/cli/src/config/scaffold-manifest.ts`) — adding a new default is a one-line manifest edit,
not new control flow. Files are read from the resolved config source, not embedded as string
literals.

### Re-init guard

A `spur init` that finds an existing `config.yaml` is **refused (exit 1)** unless `--force`
is given — preventing a stray `init` from clobbering a configured project:

```bash
spur init                  # → "Already initialized: .spur/config.yaml. Use --force to overwrite." (exit 1)
spur init --force          # → overwrites
```

## Examples

```bash
spur init                        # scaffold with defaults
spur init --name my-project      # custom project name
spur init --minimal              # minimal scaffold only (no rules/workflows)
spur init --force                # recreate existing files
spur init --json                 # machine-readable output
```

`--json` output shape:

```json
{
  "ok": true,
  "project": "my-project",
  "config": ".spur/config.yaml",
  "created": [".../.spur/config.yaml", ".../.spur/agents/.gitkeep", "..."],
  "skipped": [],
  "globalRulesSeeded": 0,
  "globalConfigSeeded": 1
}
```

## Verification

```bash
spur status   # should show "Project: ok, .spur: ok, Git: <branch>"
spur agent doctor   # verify your installed agents
```

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §3 Project Initialization
- `docs/04_DESIGN.md` — §1.1 `spur init` and §2.1 project config (ADR-017)
- `docs/00_ADR.md` — ADR-017 single-config-surface decision
