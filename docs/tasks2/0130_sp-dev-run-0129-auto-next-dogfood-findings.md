---
template: review
schema_version: 1
name: /sp:dev-run 0129 --auto --next dogfood findings
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: [review]
dependencies: []
created_at: 2026-06-26T18:53:42.741Z
updated_at: 2026-06-27T23:40:00.531Z
---

## 0130. /sp:dev-run 0129 --auto --next dogfood findings

### Background
#### Review Findings

The `/sp:dev-run 0129 --auto --next` dogfood run surfaced six findings against the dev-pipeline +
dogfood tooling. All six are now resolved (5 fixed across children, 1 closed inline as stale, 1
cancelled with the lever shipped). See `### Review` for the post-fix reflection.

Source: `docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md`.

#### Finding disposition (final)

| Finding | Severity | Final disposition |
|---------|----------|-------------------|
| F1 — dogfood observe-only not enforced for pipeline testees | P1 | ✅ fixed — `dev-dogfood` defaults to observe-only (`--max-retry 0`) for all testees (0135) |
| F2 — `--next` ignored in full mode is prose-only, not deterministic | P1 | ✅ fixed — mandatory emission step in command + SSOT reference (0136) |
| F3 — `implement` transitions `backlog→wip` before code is written (half-state) | P2 | ✅ fixed — pipeline onEnter reordered; transition fires after implement succeeds (0137) |
| F4 — review template `### Review` ships empty scaffold with no P-table | P2 | ✅ closed inline — template already ships the table; finding was stale (no code change) |
| F5 — no dedicated `spur workflow cancel <run-id>` verb | P3 | ✅ fixed — `cancel` verb shipped (0138) + pid tracking so it kills the in-flight subprocess (0140) |
| F6 — low cache-hit rate when `dev-run` driven programmatically | P3 | ❌ cancelled — cache-conservation guidance shipped to the driver surface (monitor-ledger/SKILL/dev-run, in 0139); task cancelled because the cache% baseline is a self-reported estimate and no per-step telemetry exists in Spur to verify an improvement |

#### Constraints

In-scope: F1–F6 (fix in priority order P1 → P2 → P3). Out-of-scope: redesigning the dogfood
protocol; changing the task-pipeline stage sequence beyond the F3 transition move; the
`spur workflow run`/`trace` core. Boundary: fixes land in `plugins/sp/**`,
`apps/cli/src/commands/{workflow,task}.ts`, and `config/workflows/task-pipeline.yaml`. Safety: any
`task-pipeline.yaml` change keeps the existing happy-path green (verified — 50/50 workflow tests).
### Requirements
- [ ] R1. Every open finding (F1, F2, F3, F5, F6) is addressed per its severity tier, and
      F4 is verified-and-closed with evidence (it is already satisfied —
      `config/templates/task/review.md:40-48` ships the P-table). The per-finding fix
      steps and verification criteria live in the `### Plan` checklist.
- [ ] R2. The `### Review` section is filled after the fix round with the post-fix
      disposition per finding, and the Background findings-table "Status at refine time"
      column is updated to reflect the final state.
### Plan
0130 is a **parent/umbrella task** — it owned the findings and the roster; the work lived in its
children. **All children are now `done` or `cancelled` — 0130 is closing.**

**Sub-task roster (final).**

| Sub-task | Covers | Title | Status |
|----------|--------|-------|--------|
| `[0137](0137_f3-eliminate-implement-step-half-state-backlog-wip-before-co.md)` | F3 (P2) | eliminate implement-step half-state | ✅ done |
| `[0135](0135_f1-dogfood-pipeline-mutating-gate-for-pipeline-driving-teste.md)` | F1 (P1) | dogfood/pipeline mutating-gate | ✅ done |
| `[0136](0136_f2-deterministic-cli-warning-when-next-is-ignored-in-full-mo.md)` | F2 (P1) | deterministic --next-ignored CLI warning | ✅ done |
| `[0138](0138_f5-spur-workflow-cancel-run-id-verb.md)` | F5 R1 (P3) | spur workflow cancel verb | ✅ done |
| `[0140](0140_f5-follow-up-track-async-run-pid-so-spur-workflow-cancel-can.md)` | F5 R2 (P3) | pid tracking so cancel kills the subprocess | ✅ done |
| `[0139](0139_f6-improve-cache-hit-rate-for-programmatic-dev-run-drives.md)` | F6 (P3) | cache-conservation guidance shipped, then cancelled (unverifiable without per-step telemetry) | ❌ cancelled |

**F4 — closed inline (not a child task).**

- [x] **F4 (P2)** — Confirmed: `config/templates/task/review.md:40-48` ships the P1–P4 table. The
  dogfood finding was stale. Closed with evidence; no code change.
- [x] **R7** — Post-fix review recorded in `### Review`; Background findings-table updated to final
  dispositions.
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | DONE | F1 + F2 fixed (0135, 0136) — the two safety/determinism findings |
| P2 | DONE | F3 fixed (0137); F4 closed inline as stale (template already had the table) |
| P3 | DONE/CANCELLED | F5 fully fixed (0138 + 0140: verb + subprocess kill); F6 cancelled with the lever shipped (0139) — see back-issue |

**What went well.** Decomposing the umbrella into per-finding children (each ≤6h) let the work
proceed sequentially with clean verification per task. Reusing the existing `RunDao.finalizeStale`
primitive for `cancel` (0138/0140) kept the surface small and battle-tested.

**What surfaced during the work (honest).**
- **F4 was stale** — the dogfood report claimed the review template lacked a P-table it already had.
  Caught at refine time; closed inline rather than shipping a no-op.
- **F5 R2 (subprocess kill) needed infrastructure** that didn't exist (no runId→pid mapping). Split
  into 0140 rather than half-implementing; 0140 added the `pid` column + capture + kill path.
  **Review correction (2026-06-27):** 0140's first cut had two defects caught in code review — the
  launcher recorded the pid *before* the run row existed (so it never persisted in real runs), and
  SIGTERM hit the worker but not the agent grandchild. Both fixed: the worker self-records its own
  pid at row creation, and `cancel` group-SIGTERMs (`-pid`) to reap the whole tree. Now proven by a
  live end-to-end async-cancel test, not a stand-in. Lesson logged in 0140's Review: verifying the
  mechanism in isolation ≠ verifying the integration the feature claims.
- **F6 was unverifiable** — the ~46% cache-hit baseline is a self-reported estimate by the
  dogfooding agent; Spur has no per-step token telemetry. The cache-conservation guidance (the real,
  code-inspectable lever) shipped in 0139; the task itself was cancelled because no measured
  before/after is achievable without building instrumentation that's out of scope.

**Back-issues (new findings surfaced by the fix).**
- **F6 measurement gap.** If per-step cache-hit rigor is ever wanted, a separate observability task
  must add token instrumentation to the pipeline's `agent.run` steps — Spur cannot measure cache%
  today. Not filed as a task (operator marked the F6 line cancelled, not deferred).
- **Stale-pid recycling (0140).** `cancel` SIGTERMs a recorded pid without verifying the target's
  identity; a recycled pid could in theory signal an unrelated process. Low-risk for recent async
  runs; documented in `cancel`'s docstring. No fix planned.

**No regressions.** Full gate green at close (after the F5 review-fix round): 1958 pass / 0 fail,
lint clean, build green.
### References

### History
- 2026-06-27T06:50:18.806Z backlog → todo (system)
- 2026-06-27T16:50:42.475Z todo → done (system)
