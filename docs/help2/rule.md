# spur rule

Manage constraint rules and presets: evaluate the working tree against architecture, style, and
quality invariants before code ships.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `run` | Evaluate constraint rules over the working tree |
| `validate [file-or-preset]` | Validate a rule file or preset without evaluating it |
| `list` | List discovered rule files, or resolved rules for a preset |
| `trace [run-id]` | Show persisted rule run history |
| `check-shims [flags]` | Validate the two-sided transition-shim ledger (markers ↔ manifest) |
| `check-coverage-cert [flags]` | Refuse uncertified, stale or byte-mismatched coverage evidence |
| `certify-coverage -- <command>` | Run a command against an isolated coverage dir, then certify and publish |

## spur rule check-shims

```bash
spur rule check-shims [--manifest <path>] [--json]
```

| Flag | Description |
| --- | --- |
| `--manifest <path>` | Ledger manifest, relative to the project root (default: `config/transition-shims.json`) |
| `--json` | Machine-readable report |

## spur rule check-coverage-cert

```bash
spur rule check-coverage-cert [--lcov <path>] [--json]
```

| Flag | Description |
| --- | --- |
| `--lcov <path>` | Tracefile the certification must bind (default: `.coverage/lcov.info`) |
| `--json` | Machine-readable report |

## spur rule certify-coverage

```bash
spur rule certify-coverage [--lcov <path>] -- <command...>
```

| Flag | Description |
| --- | --- |
| `--lcov <path>` | Publish the certified tracefile here (default: `.coverage/lcov.info`) |
| `--json` | Machine-readable report |

## spur rule run

```bash
spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>]
spur rule run [--stop-on-first [severity]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]
```

| Flag | Description |
| --- | --- |
| `--preset <name>` | Preset to load (default: `recommended-pre-check`) |
| `--file <path>` | Ad-hoc rule file |
| `--rule <id>` | Filter the run to one rule ID |
| `--fail-on <severity>` | Exit-1 threshold: `error` \| `warning` \| `info` (default: `error`) |
| `--stop-on-first [severity]` | Stop after the first rule with findings at/above the severity |
| `--fix-mode <mode>` | `none` \| `suggest` \| `auto` (default: `none`) |
| `--dry-run` | Preview fixes without writing (with `--fix-mode auto`) |
| `--verbose` | Stream per-rule progress to stderr |

```bash
spur rule run                                  # default preset, cheap static rules
spur rule run --preset recommended-post-check  # heavier quality checks
spur rule run --rule no-direct-fetch           # one rule only
spur rule run --fail-on warning                # strict gate for CI
spur rule run --fix-mode auto --dry-run        # preview what would be fixed
```

> **POLA:** exit codes are the contract — `0` clean (or below the threshold), `1` findings at or
> above `--fail-on`. `--fix-mode auto` writes files; keep `--dry-run` in the loop until you trust
> a rule's fixes.

## spur rule validate / list

```bash
spur rule validate [file-or-preset] [--file <path>] [--preset <name>] [--kind <type>]
spur rule validate [--no-schema] [--json]
spur rule list [--preset <name>] [--json]
```

`validate` checks a rule file or preset without evaluating it (`--no-schema` skips schema
validation). `list` shows discovered rule files across sources, or the resolved rules of one
preset with `--preset`.

```bash
spur rule validate ./my-rule.yaml
spur rule validate --preset strict-check
spur rule list --preset strict-check
```

**Rule sources, highest priority first:** the `SPUR_RULES_PATH` env var → `.spur/rules/`
(project) → `~/.config/spur/rules/` (user) → the bundled fallback preset.

## spur rule trace

```bash
spur rule trace [run-id] [--preset <name>] [--status <status>] [--since <iso-date>] [--last <n>] [--json]
```

Persisted run history: recent runs by default (last 20), one run's timeline by id, filterable by
preset, status (`done`, `failed`), and start date.

```bash
spur rule trace
spur rule trace --status failed --last 50
```

## See also

- [Daily development workflow](./daily-development-workflow.md) — the check step
- [workflow](./workflow.md) — wiring rules into pipelines

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: rule.txt + verbs/rule_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
