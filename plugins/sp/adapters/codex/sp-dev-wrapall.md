---
name: sp-dev-wrapall
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
disable-model-invocation: true
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow.

## Usage

$sp-dev-wrapall [--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"<json-encoded-wbs-list>","feature":"<id|>","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

<!-- adapter:generated v1 snapshot:9b56c69cfc36 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
