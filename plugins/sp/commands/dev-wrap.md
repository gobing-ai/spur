---
description: Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup
argument-hint: "<wbs> [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Wrap

Wraps the **wrapup-pipeline.yaml** workflow.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to wrap. | required |
| `--auto` | Skip objective HITL gates. | off |
| `--merge` | Merge the wrap branch. | off |
| `--dry-run` | Render the wrap without writing. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-wrap <wbs> [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```
