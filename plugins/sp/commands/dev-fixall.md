---
description: Fix all lint, type, and test errors systematically across the working tree
argument-hint: "[<validation-command>] [--max-retry <n>] [--scope <path>]"
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

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-fixall [<validation-command>] [--max-retry <n>] [--scope <path>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-fixall) (fixall).

