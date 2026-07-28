---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
argument-hint: "\"<idea>\" [--auto] [--skip-design] [--design-approved] [--idea-approved]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Usage

```
/sp:dev-idea "<idea>" [--auto] [--skip-design] [--design-approved] [--idea-approved]
```

**Design package (unified):** `design` var `auto` (default) | `skip` (`--skip-design`).
Default authors per-task `design` in the batch; `--skip-design` leaves Design blank (refine later).
There is no `--design` force flag — Design is default-on; only `--skip-design` opts out.

**Idea-evaluation taste gate:** After discovery, the pipeline pauses on an idea-evaluation report
(urgency/necessity, premises, pros/cons, alternatives). Approve continues to feature-create; reject
cancels with no feature. `--auto` still pauses unless `--idea-approved` marks prior in-session
approval (`idea_approved=true`).

## Implementation

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|skip","design_approved":"false|true","idea_approved":"false|true"}'
```
