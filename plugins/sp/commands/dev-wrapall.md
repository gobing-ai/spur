---
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
argument-hint: "[--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow.

## Usage

/sp:dev-wrapall [--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"<json-encoded-wbs-list>","feature":"<id|>","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

