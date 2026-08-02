---
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
argument-hint: "[--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--since` `<iso-date>` | Wrap tasks completed since a date. | configured |
| `--feature` `<id>` | Wrap tasks in a feature. | omitted |
| `--status` `<s>` | Only wrap tasks in a status. | done |
| `--auto` | Skip objective HITL gates. | off |
| `--merge` | Merge wrap branches. | off |
| `--dry-run` | Render wraps without writing. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-wrapall [--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"<json-encoded-wbs-list>","feature":"<id|>","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

