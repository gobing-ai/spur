---
name: sp-dev-wrap
description: Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup
disable-model-invocation: true
---

# Dev Wrap

Wraps the **wrapup-pipeline.yaml** workflow.

## Usage

$sp-dev-wrap <wbs> [--auto] [--merge] [--dry-run]

## Implementation

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto","merge":"true|false"}' [--dry-run]
```

<!-- adapter:generated v1 snapshot:9dc319a7f990 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
