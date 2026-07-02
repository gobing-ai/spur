# spur rule

> Manage constraint rules and presets. Enforce architecture, style, and quality invariants
> before code ships. Backed by `@gobing-ai/ts-rule-engine`. Rules live under `.spur/rules/`
> (project layer), `~/.config/spur/rules/` (user layer), or are bundled with `ts-rule-engine`
> (fallback).

## Subcommands

| Subcommand | Description |
|---|---|
| `run` | Evaluate constraint rules over the working tree |
| `validate [file-or-preset]` | Validate a rule file or preset without evaluating it |
| `list` | List discovered rule files, or list rules in a preset |
| `trace [run-id]` | Show persisted rule run history from SQLite |

## spur rule run

```
spur rule run [options]
```

| Flag | Default | Description |
|---|---|---|
| `--preset <name>` | `recommended-pre-check` | Preset to load |
| `--file <path>` | — | Ad-hoc rule file |
| `--rule <id>` | — | Filter run to one rule ID |
| `--fail-on <severity>` | `error` | Exit-1 threshold: `error` \| `warning` \| `info` |
| `--stop-on-first [severity]` | `error` (when bare) | Stop after first rule with findings at/above severity |
| `--fix-mode <mode>` | `none` | Fix collection/apply mode: `none` \| `suggest` \| `auto` |
| `--dry-run` | — | Preview fixes without writing (use with `--fix-mode auto`) |
| `--verbose` | — | Stream per-rule progress to stderr (e.g. `✓ passed - 0.12s`) |
| `--json` | — | Output machine-readable JSON |

### Examples

```bash
spur rule run                                          # default pre-check preset
spur rule run --preset recommended-post-check          # heavier quality checks
spur rule run --preset strict-check
spur rule run --file ./my-rule.yaml
spur rule run --rule no-direct-fetch
spur rule run --fail-on warning
spur rule run --stop-on-first warning
spur rule run --fix-mode auto --dry-run                # preview fixes
spur rule run --fix-mode auto                          # apply fixes
spur rule run --verbose --json
```

### `--stop-on-first` vs `--fail-on`

These flags are **orthogonal**:

- `--stop-on-first` controls **traversal** (when to stop evaluating).
- `--fail-on` controls **verdict** (what counts as a failing exit code).

They compose: stop early at the first finding, then threshold the partial findings via
`--fail-on`. Omitting `--stop-on-first` preserves the default exhaustive scan.

### `--fix-mode` semantics

| Mode | Collects fixes | Writes |
|---|---|---|
| `none` | no | no — byte-identical to pre-`--fix-mode` behavior |
| `suggest` | yes | no — surfaces `fixes[]` in `--json` for human review |
| `auto` | yes | yes — `effective mode = min(rule.fix.mode, maxFixMode)`. Use with `--dry-run` to preview the diff. |

Exit code is governed by `--fail-on` based on **findings** alone; applying a fix does NOT
retroactively clear the exit code (the operator re-runs to confirm green).

### Rule source priority (highest first)

1. `SPUR_RULES_PATH` env var (additional root)
2. Local `.spur/rules/` (project layer)
3. User-global `~/.config/spur/rules/` (or `SPUR_GLOBAL_RULES_DIR` override)
4. Bundled fallback (from `ts-rule-engine`) — the generic demo rules

A run that resolves **zero rules** exits 1. Setting `SPUR_GLOBAL_RULES_DIR` overrides the
global root and suppresses the bundled fallback for a hermetic run.

### JSON shape

```json
{
  "preset": "recommended-pre-check",
  "ruleCount": 22,
  "findings": [],
  "fixes": []
}
```

> **`rule run` fails loud on zero rules:** if `filteredRules.length === 0`, exit 1.

## spur rule validate

```
spur rule validate [options] [file-or-preset]
```

| Argument | Description |
|---|---|
| `file-or-preset` | File path or preset name to validate |

| Flag | Description |
|---|---|
| `--file <path>` | Ad-hoc rule file path |
| `--preset <name>` | Preset name |
| `--kind <type>` | Source kind: `file` or `preset` |
| `--no-schema` | Skip schema validation |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur rule validate --preset recommended-pre-check --json
# → { "valid": true, "kind": "preset", "source": "recommended-pre-check", "ruleCount": 22, "rules": [...] }
```

## spur rule list

```
spur rule list [options]
```

| Flag | Description |
|---|---|
| `--preset <name>` | Preset to list rules for |
| `--json` | Output machine-readable JSON |

> `rule list` is **file inventory**, not evaluation. Use `rule run --verbose` to see actual
> findings.

With `--preset`, lists the resolved preset rules. Without it, lists the effective rule-file
inventory grouped by source layer and category (`local`, `global`, and any `SPUR_RULES_PATH`
override, deduped by relative path).

## spur rule trace

```
spur rule trace [options] [run-id]
```

| Argument | Description |
|---|---|
| `run-id` | Run ID for per-run timeline detail |

| Flag | Default | Description |
|---|---|---|
| `--preset <name>` | — | Filter by preset |
| `--status <s>` | — | Filter by status: `done` \| `failed` |
| `--since <iso-date>` | — | Filter runs started on or after this date |
| `--last <n>` | `20` | Limit results (positive integer) |
| `--json` | — | Output machine-readable JSON |

Query persisted rule run history from SQLite. No argument: list recent runs (default last
20, newest first). With `<run-id>`: per-run detail showing summary metadata and per-rule
evaluation rows in execution order with finding counts, duration, and status.

Runs are persisted inline by `spur rule run` when a DB is available (direct writes from
the `ts-rule-engine` `RulePersistenceAdapter`; Spur writes via `DbRulePersistenceAdapter`).

## Presets

| Preset | Purpose |
|---|---|
| `recommended-pre-check` | Cheap static source-shape rules (default) |
| `recommended-post-check` | Heavier artifact-dependent quality checks (coverage) |
| `strict-check` | Strict boundary + runtime + HTTP rules |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.3 Checking
- `docs/04_DESIGN.md` — §1.1 `spur rule` family (canonical surface)
- `config/rules/` — bundled rule presets
