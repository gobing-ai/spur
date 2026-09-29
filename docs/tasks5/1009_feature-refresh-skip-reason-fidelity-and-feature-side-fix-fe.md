---
schema_version: 1
name: Feature refresh skip-reason fidelity and feature-side --fix fence coverage (1008 P3-1/P3-4)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:16.889Z
updated_at: "2026-09-29T19:28:44.797Z"
feature_id: F91

ac_altitude: task-local
---

## 1009. Feature refresh skip-reason fidelity and feature-side --fix fence coverage (1008 P3-1/P3-4)

### Background

Origin: task 1008 session review (run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600; preserved review answer `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt`, Dimension 2 + Findings). P3-1/P3-4 were recorded in task 1008's Review table as "Recorded" pointers; this task is their implementation home.

**P3-1 skip-reason mislabel (verbatim finding):** "a feature whose Tasks section exists but whose unclosed fence opens inside the Tasks body passes `hasSection('Tasks')`, then `assertFenceBalance` throws inside `replaceMarkerRegion` and the catch (`feature-service.ts:390`) labels it `no-tasks-marker-region` — the reported cause is wrong (it is a fence, not a missing marker). The two-value reason vocabulary is per spec, so this is a labeling nit, not a spec breach; the skip itself IS reported (R4's goal)."

Current code path (`packages/app/src/services/feature-service.ts:388-392`):

```ts
try {
    doc.replaceMarkerRegion('Tasks', table);
} catch {
    skipped.push({ id: feature.id, reason: 'no-tasks-marker-region' });
    continue;
}
```

Why it matters: refresh output sends the operator hunting for a missing marker region when the real fix is "close the fence" (the same actionable message the L2 finding emits). The domain already exposes `MarkdownDocument.unclosedFenceLine()` (task 1008 R1), so the catch can classify the true cause without new parsing.

**P3-4 feature-side `--fix` coverage gap (verbatim finding):** "R2's '--fix must never auto-close' is directly tested only on the task path; feature check --fix shares `applyStructuralRepairs` so risk is low, but the feature-side assertion is absent. `apps/cli/tests/commands/feature.test.ts:413-436`."

The task-path test (`apps/cli/tests/commands/task.test.ts`, "check reports an unclosed code fence as an L2 error; --fix never auto-closes (task 1008 R2)") asserts: `L2.unclosed-code-fence` finding with severity `error`, message naming a line, and after `check --fix` the body still contains the fence text (fixture cleaned up via commit 12d863b9b). The feature test (`apps/cli/tests/commands/feature.test.ts:413-436`) asserts only the finding — no `--fix` leg — and cleans up via `rmSync` in a `finally` (shared temp-corpus cwd).

References:

- Preserved review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-1, P3-4)
- Task 1008 (R2 source requirement, R4 skipped shape) · task 1008 Review table rows P3-1/P3-4 · commit 12d863b9b (task-path fixture cleanup)
- Feature F91 (corpus gate integrity)

### Requirements

- **R1 (skip-reason fidelity)** — when a feature's Tasks section exists but its unclosed fence opens inside the Tasks body, the refresh skip reason must name the actual state (fence), not `no-tasks-marker-region`. Detail: in the `replaceMarkerRegion` catch (`packages/app/src/services/feature-service.ts:388-392`), classify with `doc.unclosedFenceLine()` — non-null → reason `unclosed-code-fence`; null → keep `no-tasks-marker-region` for a balanced document with no marker region; `missing-tasks-section` unchanged. Adding a third reason value is an observable-output change (same class as 1008 R4): update the refresh contract line in `docs/04_DESIGN.md` in the same commit.
- **R2 (feature-side --fix coverage)** — a direct feature-path test proving `feature check --fix` repairs structural findings but never auto-closes an unclosed fence, mirroring the task-path test (shared `applyStructuralRepairs` engine — the test guards the shared contract). Extend the existing fence test at `apps/cli/tests/commands/feature.test.ts:413-436` with a `--fix` leg and keep the `rmSync` cleanup in `finally`.

### Acceptance Criteria

- [ ] AC1 — Feature refresh skip reason is `unclosed-code-fence` (not `no-tasks-marker-region`) when the unclosed fence opens inside the Tasks body, and `no-tasks-marker-region` is still emitted for a balanced document without a marker region — both covered by tests in `packages/app/tests/services/feature-service.test.ts` (req: R1)
- [ ] AC2 — `apps/cli/tests/commands/feature.test.ts` fence test asserts `--fix` leaves the unclosed fence text intact, fixture cleanup retained; targeted run green (req: R2)

Task-only checks (ac_altitude: task-local): `docs/04_DESIGN.md` refresh contract mentions the third reason value; no existing reason name changed.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Implementation guidance from the 1008 review (update during implement):

1. `packages/app/src/services/feature-service.ts:388-392` — replace the blind catch label: `const fence = doc.unclosedFenceLine(); skipped.push({ id: feature.id, reason: fence !== null ? 'unclosed-code-fence' : 'no-tasks-marker-region' });` — no new parsing; `unclosedFenceLine()` is the 1008 R1 domain API.
2. `packages/app/tests/services/feature-service.test.ts` — fixture A: feature with a Tasks section whose fence opens inside the Tasks body → expect skipped reason `unclosed-code-fence`; fixture B: balanced document with a Tasks section but no marker region → `no-tasks-marker-region` (guards the classification split).
3. `apps/cli/tests/commands/feature.test.ts:413-436` — after the finding assertions, run `feature check --fix`, then assert the corrupted body still contains the fence text; keep `rmSync(featurePath)` in `finally`.
4. Same-commit doc touch: `docs/04_DESIGN.md` refresh response (`skipped: [{id, reason}]`) — add the third reason value.

Constraints (anti-drift):

- Do NOT change L2 emission, `assertFenceBalance`, `--fix` behavior, or existing reason names (`missing-tasks-section`, `no-tasks-marker-region` keep their semantics).
- Service returns data; CLI formats — `apps/cli/src/commands/feature.ts:386/:392` consume `result.skipped` generically, so no CLI change is expected; verify, don't assume.
- No new flags; no server-surface change here (that is task 1011).
- `ac_altitude: task-local` is already set (ADR-062 carve-out) — do not remove.

Verify: `(cd packages/app && bun test tests/services/feature-service.test.ts)` and `(cd apps/cli && bun test tests/commands/feature.test.ts -t fence)`; `bun run spur-check` at the quality boundary.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-1, P3-4; Dimensions 2–3)
- Tasks: 1008 (R2/R4 source; Review table rows P3-1/P3-4), 1011 (server-side skipped parity) · Feature: F91 · Commit: 12d863b9b
- Code anchors: `packages/app/src/services/feature-service.ts:388-392` · `apps/cli/tests/commands/feature.test.ts:413-436` · `apps/cli/tests/commands/task.test.ts` fence test · `packages/domain/src/planning/markdown-document.ts` `unclosedFenceLine()` (1008 R1)

### History
