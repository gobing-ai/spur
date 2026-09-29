---
schema_version: 1
name: Feature refresh skip-reason fidelity and feature-side --fix fence coverage (1008 P3-1/P3-4)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:16.889Z
updated_at: "2026-09-29T18:20:11.306Z"
feature_id: F91

ac_altitude: task-local
---

## 1009. Feature refresh skip-reason fidelity and feature-side --fix fence coverage (1008 P3-1/P3-4)

### Background

Task 1008 (run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600) review surfaced two feature-side follow-ups, both recorded in the task's Review findings table and the preserved review answer (`.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt`, P3-1/P3-4):

- **P3-1 skip-reason fidelity** — when a feature's unclosed fence opens *inside* the Tasks body, refresh skips it as `no-tasks-marker-region`, a mislabel of the real state (`packages/app/src/services/feature-service.ts:389-391`).
- **P3-4 test gap** — R2's "`--fix` must never auto-close an unclosed fence" is directly tested only on the task path (`apps/cli/tests/commands/task.test.ts`); the feature path shares the same engine (`apps/cli/tests/commands/feature.test.ts:413` covers the finding but not `--fix`).

Both live on the feature-service/feature-check surface; one implementer can close them in one run.

### Requirements

- **R1 (skip-reason fidelity)** — when a feature's Tasks section exists but its unclosed fence opens inside the Tasks body, the refresh skip reason must name the actual state (unclosed fence / hidden marker region), not `no-tasks-marker-region`. The distinct `no-tasks-marker-region` reason remains for features genuinely lacking a marker region.
- **R2 (feature-side --fix coverage)** — a direct test on the feature path proving `feature check --fix` repairs structural findings but never auto-closes an unclosed fence, mirroring the task-path test (shared engine, so the test guards the shared contract against future engine changes).

### Acceptance Criteria

- [ ] AC1 — Feature refresh skip reason correctly identifies an unclosed fence opening inside the Tasks body (no `no-tasks-marker-region` mislabel), verified by a new/updated test (req: R1)
- [ ] AC2 — Feature check `--fix` never auto-closes an unclosed fence: direct feature-path test passing (req: R2)

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
