---
description: "Generate the daily or ad-hoc history-anatomy diagnostic report over already-imported history: the eleven-section report contract, closed finding taxonomy, cache branch, bounded correction, and atomic publication. Triggers: find issues, post-mortem, performance analysis, session review, history-anatomy, run the daily report, ad-hoc diagnosis"
role: reviewer
argument-hint: "[<focus>] [--mode <daily|ad-hoc>] [--date <YYYY-MM-DD>] [--since <RFC3339>] [--until <RFC3339>] [--recompute] [--agent <inline|auto|name>] [--output <path>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Find Issue

Wraps the **sp:history-anatomy** skill — the independent owner of diagnostic interpretation over
already-imported history. The skill resolves the mode contract (daily is the default and uses the
current local calendar day; ad-hoc requires a focus plus two ordered bounds), owns the report
contract (eleven sections, closed finding taxonomy, evidence rules, recurrence ledger), and
exposes the `enrich` and `validate` operations the `history-anatomy.yaml` workflow invokes.
Publication is atomic and gated behind both the deterministic structure gate and independent
evidence validation. This command never triggers an import.

## Argument Flags

| Flag                                   | Description                                                                                        | Default  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| `[<focus>]`                            | Ad-hoc focus string (required in `--mode ad-hoc`; rejected in daily).                              | omitted  |
| `--mode` `<daily\|ad-hoc>`             | Report mode. Daily uses the current local calendar day.                                            | daily    |
| `--date` `<YYYY-MM-DD>`                | Selects that local calendar day (daily; DST-aware).                                                | today    |
| `--since` `<RFC3339>`                  | Inclusive lower bound (ad-hoc; required).                                                          | omitted  |
| `--until` `<RFC3339>`                  | Inclusive upper bound (ad-hoc; required).                                                          | omitted  |
| `--recompute`                          | Force the full analyze/render/enrich/validate path; records disposition forced-recompute.          | off      |
| `--agent` `<inline\|auto\|name>`       | Execution surface selector.                                                                        | inline   |
| `--output` `<path>`                    | Explicit report output path (ad-hoc; default writes to the run directory).                         | run dir  |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-issue
/sp:dev-find-issue --date 2026-08-24
/sp:dev-find-issue --mode ad-hoc --since 2026-08-01T00:00:00Z --until 2026-08-15T00:00:00Z "focus"
/sp:dev-find-issue --recompute
```

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).

```
Skill(skill="sp:history-anatomy", args="$ARGUMENTS")
```