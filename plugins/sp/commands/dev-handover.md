---
description: Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps
role: scribe
argument-hint: "\"<blocker description>\""
allowed-tools: ["Bash", "Read", "Write"]
---

# Dev Handover

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#11-handover) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<blocker description>"` | Free-text description of the current blocker. | required |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-handover "<blocker description>"

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#11-handover) (handover).

