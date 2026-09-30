---
schema_version: 1
name: Dev-review P4 advisory cleanup sweep from I33 reviews (1021-1023)
status: backlog
template: feature-impl
created_at: 2026-09-30T21:56:23.251Z
updated_at: "2026-09-30T21:57:02.213Z"
feature_id: I33

ac_altitude: task-local
---

## 1032. Dev-review P4 advisory cleanup sweep from I33 reviews (1021-1023)

### Background

Captured from the creation title: "Dev-review P4 advisory cleanup sweep from I33 reviews (1021-1023)".

### Requirements

## Background

I33 dev-review reviews (2026-09-30, tasks 1021–1023) deferred nine P4 advisories as non-blocking. The three P3s were fixed inline in commit `f86aa20de`; these P4s remain.

## Requirements

From task 1021 review (code-verification scope recipe):
- R1: `code-verification/SKILL.md:105` — `--grep` matches the full commit message body, not just the subject; a body mention of a task id over-includes commits. Consider `--grep` + `--format=%s` restriction or documented residual risk.
- R2: `code-verification/SKILL.md:107,114` — task-file exclusion assumes cwd = repo root; state the assumption or use an explicit root anchor.
- R3: `code-verification/SKILL.md:114-118` — uncovered edge: tagged commit exists but touches only the task file → empty scope; name the degradation.

From task 1022 review (naming/contract hygiene):
- R4: `dev-review.md:18` restates the full `--focus` vocabulary inline next to the SSOT link — second copy with silent-drift risk; link-only or pin equality in the R4 test.
- R5: R5 `--fix` test slices on `## Mode: review` heading anchors — heading-anchored slicing can silently match the wrong section if ordering changes; consider stable markers.

From task 1023 review (selector surface):
- R6: Positional-only examples survive in 4 cross-referencing docs (`code-verification/SKILL.md:39`, `next-router/references/routing-table.md:134`, `spur-dev/references/execution-workflow.md:50`, `spur-dev/references/gate-checklists.md:158`) — migrate before alias removal.
- R7: `sys-architecture/SKILL.md:76` characterizes `/sp:dev-review` as a per-task DIFF review — refresh to cover task sets and advisory `--scope` path review.
- R8: Specify the two unspecified selector edges: `--scope` nesting-merge direction (`--scope apps,apps/cli`) and a trailing positional beside `--tasks` (error vs absorbed).

### Acceptance Criteria

#### AC-1: All nine P4 advisories dispositioned
- G/R: For each of R1–R8 (R6 counts as four files), when addressed, then each either carries the fix or an explicit documented residual-risk note in place, with file:line traceability to this task.

#### AC-2: No behavior change beyond docs/contract text
- G/R: Existing section-scoped tests (command/skill contract tests) pass unchanged or are updated only where a test pins the changed text.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
