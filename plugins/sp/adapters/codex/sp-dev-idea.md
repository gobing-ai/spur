---
name: sp-dev-idea
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create, handoff
disable-model-invocation: true
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Usage

$sp-dev-idea "<idea>" [--auto] [--design] [--skip-design] [--design-approved]

## Implementation

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip","design_approved":"false|true"}'
```

<!-- adapter:generated v1 snapshot:664289f598a2 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
