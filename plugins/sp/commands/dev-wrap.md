---
description: Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup
argument-hint: "<wbs> [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Dev Wrap

Wraps the **wrapup-pipeline.yaml** workflow.

## Usage

/sp:dev-wrap <wbs> [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

