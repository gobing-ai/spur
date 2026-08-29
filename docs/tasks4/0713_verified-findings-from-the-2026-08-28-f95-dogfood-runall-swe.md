---
schema_version: 1
name: "Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)"
status: todo
template: issue
created_at: 2026-08-29T02:33:38.958Z
updated_at: "2026-08-29T02:35:25.658Z"
feature_id: F95
---

## 0713. Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)

### Background

The 2026-08-28 dogfood of `/skill:sp-dev-runall --feature F95 --auto --next --agent inline`
(run id `20260828-runall-f95-inline-01`, report
`docs/dogfood/2026-08-28-sp-dev-runall-f95-inline-dogfood.md`) surfaced a findings sweep.
Two findings were fixed inline the same day and are excluded here: (1) verify-leg surface
cross-references (`verdict` + answer-file flow, `[invalid-solution]` gate) added to
`plugins/sp/skills/spur-cli/references/tasks/verbs.md`; (2) stale global `spur` bundle
refreshed via `build:bundle` — `spur task update --status` now errors loudly instead of
silently no-oping.

Deferred requirements on tasks 0698–0702 are already tracked inside those task files and
are out of scope here. This task holds only the code-level remainder.

### Requirements

- R1 — Resolver ordering guard: when a task's Plan section declares children-first / soft
  ordering that contradicts its frontmatter `dependencies[]` (edges absent), the runall
  resolve step (or a `feature check` L-rule) must emit a warning naming the missing edges.
  Evidence: 0698 was scheduled first (WBS tie-break) and failed verify with 37 unmet before
  `spur task deps 0698 add 0699 0700 0701 0702` fixed the batch.
- R2 — `spur task record` idempotency: re-recording must not leave a stale verdict header
  from a prior run in the Review section. Evidence: 0700's first `record` wrote a FAIL
  header that survived as a stale line after the resumed PASS-adjacent re-record.
- R3 — Pre-existing defect triage (surfaced, out of scope of the F95 batch):
  (a) 111 line-length findings in `config/workflows/history-anatomy.yaml`, 4 of them live
  shell lines where reflow risks semantics;
  (b) cwd-dependent `resolveRepoRoot` test failure in `packages/app`;
  (c) corpus-check baseline noise — the checker fails when sibling/parallel tasks are dirty.

### Acceptance Criteria

- AC1: R1 — a corpus fixture with Plan-declared children-first ordering but no
  `dependencies[]` edges triggers the warning; the same fixture with edges set is silent.
- AC2: R2 — a regression test replays record→re-record with a changed verdict and asserts
  no stale header remains in the Review section.
- AC3: R3 — each of (a)/(b)/(c) has an explicit disposition: fixed, or a documented owner
  follow-up (line/link recorded in Notes).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan
1. R1: locate the resolve/topo step in the runall driver path (packages/app) or the feature
   check rule table; add the warning with a fixture test.
2. R2: read `task record`'s Review writer (apps/cli/src/commands/task.ts:948) for the
   header write path; make re-record idempotent; regression test.
3. R3: triage each item; (a) needs semantic-aware handling of shell lines inside YAML block
   scalars before any bulk reflow.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
