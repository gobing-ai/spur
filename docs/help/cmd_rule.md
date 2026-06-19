# spur rule

> Manage constraint rules and presets. Enforce architecture, style, and quality invariants.

## Subcommands

| Subcommand | Description |
|---|---|
| `run` | Evaluate constraint rules over the working tree |
| `validate [file-or-preset]` | Validate a rule file or preset without evaluating it |
| `list` | List discovered rule files, or list rules in a preset |
| `trace [run-id]` | Show persisted rule run history |

## spur rule run

```
spur rule run [options]
```

| Flag | Default | Description |
|---|---|---|
| `--preset <name>` | `recommended-pre-check` | Preset to load |
| `--file <path>` | — | Ad-hoc rule file |
| `--rule <id>` | — | Filter run to one rule ID |
| `--fail-on <severity>` | `error` | Exit 1 threshold: `error` \| `warning` \| `info` |
| `--stop-on-first [severity]` | — | Stop after first finding at/above severity |
| `--fix-mode <mode>` | `none` | Fix mode: `none` \| `suggest` \| `auto` |
| `--dry-run` | — | Preview fixes without writing (use with `--fix-mode auto`) |
| `--verbose` | — | Stream per-rule progress to stderr |
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

> `rule list` is **file inventory**, not evaluation. Use `rule run --verbose` to see actual findings.

### Rule sources (layered, highest-priority first)

1. `SPUR_RULES_PATH` env var
2. Local `.spur/rules/` (project layer)
3. Global `~/.config/spur/rules/` (user layer, or `SPUR_GLOBAL_RULES_DIR`)
4. Bundled fallback (from `@gobing-ai/ts-rule-engine`)

### Verified inventory (2026-06-19)

16 rule files across 7 categories: `boundary/`, `migration/`, `quality/`, `strict/`, `structure/`,
`surface/`, `typescript/`. The `recommended-pre-check` preset has 22 rules.

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
| `--status <s>` | — | Filter by status |
| `--since <iso-date>` | — | Filter runs started on or after this date |
| `--last <n>` | — | Limit results |
| `--json` | — | Output machine-readable JSON |

## Presets

| Preset | Purpose |
|---|---|
| `recommended-pre-check` | Cheap static source-shape rules (default) |
| `recommended-post-check` | Heavier artifact-dependent quality checks |
| `strict-check` | Strict boundary + runtime + HTTP rules |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.3 Checking
- `docs/04_DESIGN.md` — §rule surface
