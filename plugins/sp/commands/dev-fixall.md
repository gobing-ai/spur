---
description: Fix all lint, type, and test errors systematically across the working tree
role: coder
argument-hint: "[<validation-command>] [--max-retry <n>] [--scope <path>] [--gate-log <path>] [--findings <anchors>]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# Dev Fixall

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-fixall) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<validation-command>]` | Validation command to iterate against. | project gate |
| `--max-retry` `<n>` | Max fix iterations. | 3 |
| `--scope` `<path>` | Scope fixes to a path. | entire working tree |
| `--gate-log` `<path>` | Read a captured validation-run log first; start fixes at the finding anchors it names (R3, task 0482) instead of re-deriving the failure. | none |
| `--findings` `<anchors>` | Space-separated `file:line` anchors already extracted from the gate log (R3, task 0482). Fix these first, in order; they are the authoritative list of what broke. | none |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-fixall [<validation-command>] [--max-retry <n>] [--scope <path>] [--gate-log <path>] [--findings <anchors>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-fixall) (fixall). Pipeline signal: when `--gate-log` is set (the `test-fix` hop), run no full gate — the `test-recheck` state immediately after is the deciding run (R4, task 0483).

When dispatched from the pipeline's test-fix stage (F96, task 0950), the gate log carries a
`residual artifact` block (`<wbs>-residuals.json`) and the findings file already
contains the merged residual anchors: treat those items as fix targets, in order,
alongside gate anchors. The fixer may write `.spur/run/<wbs>-residual-deferrals.json`
— one `{id, reason}` entry per item — but only for P3 findings or diff markers it
cannot fix inside the task; the done stage settles deferrals into follow-up tasks.

