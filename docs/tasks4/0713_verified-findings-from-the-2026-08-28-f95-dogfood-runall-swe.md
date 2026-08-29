---
schema_version: 1
name: "Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)"
status: todo
template: issue
created_at: 2026-08-29T02:33:38.958Z
updated_at: "2026-08-29T02:55:11.831Z"
feature_id: F95
---

## 0713. Verified findings from the 2026-08-28 F95 dogfood runall sweep (runall-f95-inline-01)

### Background

Self-contained findings task from the 2026-08-28 dogfood of
`/skill:sp-dev-runall --feature F95 --auto --next --agent inline` (run id
`20260828-runall-f95-inline-01`). Every finding below carries its evidence inline; no external
report is required to act on this task.

Already fixed inline the same day (excluded from Requirements):

- Verify-leg surface docs: `plugins/sp/skills/spur-cli/references/tasks/verbs.md` now documents
  the no-`verify`-verb flow (answer file → `spur task verdict` → `spur task record`) and the
  `[invalid-solution]` wip→testing Solution gate.
- `spur task update --status` silent no-op: root cause was the stale global `spur` bundle, not
  source (`bun run apps/cli/src/index.ts task update --status wip 9999` →
  `error: unknown option '--status'`). Refreshed via `build:bundle`; global now errors loudly.
- `bun --coverage=false` invalid: documented gotcha only, no live code uses it.

Out of scope: deferred requirements on tasks 0698–0702 — each is already recorded inside its own
task file (Testing/Review sections).

### Requirements

- R1 — Resolver ordering guard (P1). Symptom: the runall resolve step ordered tracking parent 0698
  first (WBS tie-break — no `dependencies[]` edges existed on 0698–0702), so its verify ran before
  any child was implemented: verdict FAIL with 37 unmet (19/19 requirements, 18/18 ACs, children
  todo) and the batch halted. 0698's own Plan section declared children-first ordering, but the
  resolver reads only frontmatter `dependencies[]`. In-run fix was data, not code:
  `spur task deps 0698 add 0699 0700 0701 0702` → children-first re-run. Required: when a task's
  Plan declares children-first / soft ordering that contradicts missing frontmatter edges, the
  resolve step (or a `feature check` L-rule) must warn naming the missing edges.
- R2 — `spur task record` idempotency (P2). Symptom: 0700's first `record` wrote a FAIL verdict
  header into the task's Review section; after the child timed out and the resumed run re-recorded
  with an updated outcome, the stale FAIL header remained in
  `docs/tasks4/0700_corpus-gates-tell-the-truth-checkbox-flip-review-reconciliat.md` (uncommitted
  at the time). The Review writer does not clear/replace header lines from a prior record.
  Surface: `task.command('record')`, apps/cli/src/commands/task.ts:948.
- R3 — Pre-existing defect triage (surfaced by the batch, out of its scope):
  - (a) `config/workflows/history-anatomy.yaml`: 111 line-length lint findings, 4 of them live
    shell lines inside YAML block scalars where naive reflow changes semantics (observed during
    0702's zero-new-violations review; batch committed none of them).
  - (b) `packages/app` test suite: a cwd-dependent `resolveRepoRoot` test failure — fails or
    passes depending on the directory the suite is launched from (observed by the 0699 child
    during its scoped `bun test` run; unrelated to F95 code).
  - (c) corpus-check baseline noise: the checker reports failures caused by sibling/parallel task
    dirt rather than the task under check (observed when `corpus-check` ran dirty from the batch's
    own section writes; note 0700's uncommitted `packages/app/src/services/corpus-check.ts` and
    `scripts/commands/regen-corpus-baseline.ts` edits may already address part of this — triage
    against them before writing new code).

### Acceptance Criteria

- AC1: R1 — a corpus fixture with Plan-declared children-first ordering but no
  `dependencies[]` edges triggers the warning; the same fixture with edges set is silent.
- AC2: R2 — a regression test replays record→re-record with a changed verdict and asserts
  no stale header remains in the Review section.
- AC3: R3 — each of (a)/(b)/(c) has an explicit disposition: fixed, or a documented owner
  follow-up (line/link recorded in Notes). For (c), the disposition must state whether 0700's
  uncommitted corpus-check changes already cover it.

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
   scalars before any bulk reflow; (c) first diff against 0700's uncommitted corpus-check edits.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Batch tasks: 0698 (parent/findings sweep), 0699, 0700, 0701, 0702 — commits `7d8411002`,
  `a2beb4d51`, `4748fa56`, `4e1a19588`.
- Origin run: 20260828-runall-f95-inline-01 (dogfood artifacts are local-only by gitignore; this
  task is the durable record of its unsolved findings).
- Related docs fix (landed): `plugins/sp/skills/spur-cli/references/tasks/verbs.md`.

### History
