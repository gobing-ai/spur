---
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
argument-hint: "[[`--since`](../skills/spur-dev/references/dev-operations.md#flag-since) <iso-date>] [[`--feature`](../skills/spur-dev/references/dev-operations.md#flag-feature) <id>] [[`--status`](../skills/spur-dev/references/dev-operations.md#flag-status) <s>] [[`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto)] [[`--merge`](../skills/spur-dev/references/dev-operations.md#flag-merge)] [[`--dry-run`](../skills/spur-dev/references/dev-operations.md#flag-dry-run)]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow.

## Usage

/sp:dev-wrapall [--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"<json-encoded-wbs-list>","feature":"<id|>","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

