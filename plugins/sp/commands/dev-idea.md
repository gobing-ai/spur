---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
argument-hint: "\"<idea>\" [--auto] [--design] [--skip-design] [--design-approved]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Usage

```
/sp:dev-idea "<idea>" [--auto] [--design] [--skip-design] [--design-approved]
```

Design package (unified): `design` var `auto` (default) | `force` (`--design`) | `skip` (`--skip-design`).
Default/force author per-task `design` in the batch; `--skip-design` leaves Design blank (refine later).

## Implementation

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip","design_approved":"false|true"}'
```
