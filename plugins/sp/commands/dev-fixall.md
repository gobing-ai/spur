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

Under the pipeline, the `test-recheck` state runs the full gate immediately after this hop — that is
the deciding run. When `--gate-log` is set (the pipeline signal), fixall runs **no full gate at
all**: targeted probes (`bun test <file> --test-name-pattern <test>`) during fix loops, then one
`bun run lint` before returning. Invoked standalone, it keeps the single confirming run (R4, task
0483). `qualityGateCmd` itself is unchanged so `test-recheck` still runs the full gate.

