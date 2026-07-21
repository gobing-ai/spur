---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create, handoff
argument-hint: "\"<idea>\" [--auto] [--design] [--skip-design] [--design-approved]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Usage

/sp:dev-idea "<idea>" [--auto] [--design] [--skip-design] [--design-approved]

## Implementation

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip","design_approved":"false|true"}'
```

