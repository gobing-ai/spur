---
schema_version: 1
name: Exclude transient .tmp-* test-fixture dirs from require-corresponding-test
status: todo
template: issue
created_at: 2026-09-30T13:44:22.228Z
updated_at: "2026-09-30T14:00:39.850Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1013. Exclude transient .tmp-* test-fixture dirs from require-corresponding-test

### Background

Filed from the A9 post-batch review (open issue O2 + improvement I3). During the A9 batch (2026-09-30 ~00:49 PDT) a full-repo gate run aborted in ~17s because an earlier aborted CLI test run leaked a fixture directory `apps/cli/tests/.tmp-task-test-1790754157031/` into the tree; `require-corresponding-test` flagged the leaked dir and manual removal was required before the gate passed. Fixture dirs of this shape are created by tests themselves (`.tmp-task-test-<epoch-ms>` naming in apps/cli test fixtures) and cleaned in teardown — but an aborted/killed run never reaches teardown, so any subsequent gate run fails spuriously. Also folds in the review-path improvement: tests asserting artifact ABSENCE under the shared repo-root `.spur/run` must pre-clear before asserting (the shared-fixture race class hit at task.test.ts verdictArtifacts loop, ~L2409; hardened via `rmSync` pre-clear in the lint-fixture test during merge integration, commit `1451c856e`).

### Requirements

- [ ] R1. `config/rules/structure/test-location.yaml` adds an exclude for transient fixture dirs: `**/tests/.tmp-*/**` (covers `apps/cli/tests/.tmp-task-test-*/` and siblings); include rows unchanged.
- [ ] R2. The exclusion lives in the local layered override that already owns the includes (local shadows global); global rule file untouched.
- [ ] R3. No broader exclusions: only `.tmp-*` under tests dirs. Genuine missing-test findings must still fire (guard against over-exclusion).
- [ ] R4. Regression proof: a fixture dir `apps/cli/tests/.tmp-probe-x/` (empty dir, and with a stray `a.test.ts`) produces no `require-corresponding-test` finding.
- [ ] R5. `bun run corpus-check` passes — checker-policy change requires the explicit unsuppressed audit (T10, AGENTS.md).
- [ ] R6. Review checklist (sp:dev-review skill references) gains an absence-assert hygiene line: tests asserting shared-artifact absence (repo-root `.spur/run`) pre-clear with `rmSync(p, { force: true })` or use unique per-run names — precedent: `apps/cli/tests/commands/task.test.ts` verdictArtifacts loop (~L2409), hardened in merge commit `1451c856e`.
- [ ] R7. Scope is rule config + checklist/docs only (Task bucket per T10); no production source changes.

### Acceptance Criteria

- [ ] AC1 — A leaked `.tmp-*` fixture dir under tests no longer fails `require-corresponding-test` (req: R1, R4)
- [ ] AC2 — Genuine missing-test findings still fire after the exclusion (req: R3, R4)
- [ ] AC3 — `bun run corpus-check` passes for the checker-policy change (req: R5)
- [ ] AC4 — Review checklist carries the absence-assert hygiene rule (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Reproduce: create `apps/cli/tests/.tmp-repro-probe/` (empty dir; then with a stray `a.test.ts`), run `spur rule run --rule require-corresponding-test --json` → observe findings.
2. Edit `config/rules/structure/test-location.yaml`: add exclude row `**/tests/.tmp-*/**` matching the existing excludes' style (declaration-only, schema/migration). Local layered override shadows global — keep global untouched.
3. Re-run the rule: probe dir no longer flagged. Negative check: temporarily remove a real pairing in a scratch copy (or rely on existing rule tests) to confirm genuine findings still fire.
4. Add/extend the rule's test where existing rule tests live (follow test-location convention; in-memory or tmp-dir fixture).
5. Checklist line: locate the review checklist in sp:dev-review skill references; add the R6 absence-assert line verbatim.
6. `bun run corpus-check` (T10 audit for checker-policy changes) — this is the Task-bucket gate, do not skip.
7. Record receipts in Testing; verify verdict rows can cite R1–R7 / AC1–AC4.

### Root Cause

Fixture naming `.tmp-task-test-<epoch>` is created by tests and removed in teardown; an aborted/killed run never reaches teardown. The rule had no concept of transient fixture paths, so gate-level false positives were guaranteed on any post-abort gate run. The absence-assert half: shared repo-root `.spur/run` artifacts made absence assertions order-dependent across tests — one test's cleanup loop racing another's artifact creation.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Targeted: `spur rule run --rule require-corresponding-test` before/after with the probe fixture (expected: findings → clean).
- Negative: genuine missing-test finding still produced for a non-excluded path.
- Audit: `bun run corpus-check` (unsuppressed, T10).
- No full-repo gate dependency beyond corpus-check; record rule run JSON receipts here.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- A9 post-batch review session 2026-09-30 (O2 + I3), tasks 1013–1017 filed together.
- Gate abort evidence: 2026-09-30 ~00:49 PDT, leaked `apps/cli/tests/.tmp-task-test-1790754157031/`.
- `config/rules/structure/test-location.yaml` (local override owns includes/excludes).
- `apps/cli/tests/commands/task.test.ts` ~L2409 (verdictArtifacts cleanup loop); merge commit `1451c856e` (rmSync pre-clear precedent).
- T10 / corpus-check: root AGENTS.md build & verification section.

### History
