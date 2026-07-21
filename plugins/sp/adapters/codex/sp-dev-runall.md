---
name: sp-dev-runall
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
disable-model-invocation: true
---

# Dev Runall

Wraps the **sp:spur-dev** skill.

## Usage

$sp-dev-runall --tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]

## Implementation

- Invoke the **sp:spur-dev** skill with args `runall $ARGUMENTS`.

<!-- adapter:generated v1 snapshot:af224c71f4e9 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
