---
schema_version: 1
name: "S0-sibling: make docs-pipeline proof fail-closed (task-path lookup)"
status: done
template: feature-impl
created_at: 2026-09-03T23:07:43.354Z
updated_at: "2026-09-04T21:12:07.352Z"
feature_id: D9
ac_altitude: task-local
done_forced: "true"
---

## 0760. S0-sibling: make docs-pipeline proof fail-closed (task-path lookup)

### Background

0751's review surfaced three residual findings, consolidated into this single follow-up task:

1. **docs-pipeline carries the same suppressed task-path lookup 0751 R2 removed from
   task-pipeline** — `config/workflows/docs-pipeline.yaml:145` swallows lookup failure
   (`2>/dev/null`, `|| true`, forced `exit 0`), while the resolved `taskSpecPath` folds into the
   docs-pipeline proof digest via `taskFile:` (docs-pipeline.yaml:155, :191), so a silent miss
   degrades the proof to tree-only.
2. **The first R1 rejection assertion in proof-input-fingerprint.test.ts is never awaited**
   (`packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`) — bun:test may settle
   before the matcher runs, so a regression back to the `''` sentinel could pass vacuously.
3. **Feature D9's acceptance criteria lack gherkin scenarios for proofBinding enforcement
   (0751 R4) and no-new-bypass (0751 R6)** — 0751's verify stage had to cite a companion table
   instead of exact AC labels, which the verify-stage AC-label matching contract expects.

One theme: 0751's fail-closed proof work left one sibling pipeline de-suppressed-late, one test
assertion unenforced, and the feature AC surface incomplete. They ship together as one task
because each is small, they share the 0751 review provenance, and the combined diff is one
reviewable unit.

### Requirements

- [x] R1. `config/workflows/docs-pipeline.yaml:145` task-path lookup is de-suppressed the same way task-pipeline was in 0751 R2: drop `2>/dev/null`, drop `|| true`, drop the forced `exit 0`; an empty resolved path exits non-zero naming the unresolved task. The resolved `taskSpecPath` folds into the docs-pipeline proof digest via `taskFile:` (docs-pipeline.yaml:155, :191), so a silent miss degrades proof to tree-only.
- [x] R2. Regression pin mirrors `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237` for docs-pipeline.
- [x] R3. No new bypass introduced (0751 R6 semantics).
- [x] R4. `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`: the first R1 regression assertion `expect(createGitAlternateTree(...)).rejects.toBeInstanceOf(...)` gains `await` (sibling tests use the awaited `.catch(e => e)` pattern); after the fix the test still fails against pre-0751 code, so the git-failure path stays exercised.
- [x] R5. Feature D9 acceptance criteria (`docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`) gain gherkin scenarios covering proofBinding enforcement (0751 R4) and no-new-bypass (0751 R6); scenario titles match the verify-stage AC-label matching contract (exact label = scenario title text), so future verify answer files cite exact AC labels instead of a companion table.

### Acceptance Criteria

```gherkin
Scenario: docs-pipeline proof fails closed on unresolved task path
  Given a wbs that does not resolve to a task file
  When the docs-pipeline task-path capture step runs
  Then the step exits non-zero naming the unresolved task
  And no tree-only proof digest is produced

Scenario: the R1 git-failure rejection assertion cannot pass vacuously
  Given pre-0751 fingerprint code with the '' sentinel fallback
  When the proof-input-fingerprint test suite runs
  Then the first git-failure test fails on its awaited rejection assertion

Scenario: D9 verify answers cite exact AC labels for 0751 R4 and R6
  Given the D9 feature acceptance criteria
  When a verify answer cites the proofBinding-enforcement and no-new-bypass scenarios
  Then exact-label matching resolves each citation to a scenario title
```

<!-- DD-09 coverage: this task's scenarios sit at task-local altitude, so their titles do not
     mimic the feature's. The `covers:` alias below names the D9 ship-contract scenario this
     task's R1 actually satisfies (0700 R3). -->

- [x] AC-D9a. (covers: A missing task spec fails the docs-pipeline proof step too) R1 — the docs-pipeline task-path capture step exits non-zero naming the unresolved wbs and produces no tree-only proof digest.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

0760 is a 1-sibling follow-up to 0751. The repair pattern is identical: drop `2>/dev/null` + `|| true` + forced `exit 0`, add `-z "$task_path"` + `exit 1` + a named error. The other two changes (R4 `await` and R5 gherkin AC) are mechanical, one each. Sharing one reviewable unit preserves the 0751 review provenance the original ask named.

### Plan

- [x] R1: de-suppress the task-path lookup in `config/workflows/docs-pipeline.yaml`.
- [x] R2: regression pin `packages/app/tests/workflow/docs-pipeline-proof-chain.test.ts` mirroring `task-pipeline-proof-chain.test.ts`.
- [x] R3: verify no new bypass introduced; the change *removes* a bypass, so this is structurally satisfied.
- [x] R4: add `await` via `.catch(e => e)` to `proof-input-fingerprint.test.ts:241-244`.
- [x] R5: add three gherkin scenarios to `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md` for docs-pipeline task-path failure, proofBinding (0751 R4), and no-new-bypass (0751 R6).
- [x] Run lint + targeted tests from inside `packages/app`.

### Solution

**R1 — de-suppress docs-pipeline task-path lookup.** `config/workflows/docs-pipeline.yaml:144-152` — replace the single-line `$spurBin task path $wbs --json 2>/dev/null | jq ... || true; exit 0` with a multi-line `set -e` block: resolve the path, fail closed with `echo "docs-pipeline: task path did not resolve for wbs $wbs" >&2; exit 1` on empty, otherwise write the path to `.spur/run/$wbs-docs-taskpath.txt`. The resolved `taskSpecPath` still folds into the proof digest via the two `proof.fingerprint` actions in the verify state (`taskFile: ${vars.taskSpecPath}`), so a silent miss no longer degrades the proof to tree-only.

**R2 — regression pin for docs-pipeline.** `packages/app/tests/workflow/docs-pipeline-proof-chain.test.ts` (new file) — `describe('docs-pipeline task-path lookup fails closed (task 0760 R1/R2)')` with four tests: structural suppression scan, empty-path check, `taskFile:` folding into proof digest, and a behavioral test that renders the command with a stub `emit.sh` returning `{}` and asserts `execSync` throws.

**R3 — no new bypass.** R1 removes the bypass; no other change in this slice introduces one. Verified by the same suppression scan in the R2 regression test.

**R4 — `await` the R1 rejection assertion.** `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244` — convert the `expect(...).rejects.toBeInstanceOf(...)` form to the sibling `.catch(e => e)` + `expect(err).toBeInstanceOf(...)` pattern so a thrown rejection is asserted rather than a promise of one. Matches the immediately following test in the same file.

**R5 — D9 feature AC gains gherkin scenarios.** `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md` — three new scenarios: "A missing task spec fails the docs-pipeline proof step too" (R1 docs-sibling), "The done-state verdict artifact declares the enforced proof binding" (0751 R4), and "No new bypass is introduced in the pipeline composition" (0751 R6). Titles match the verify-stage AC-label matching contract so future verify answer files cite exact AC labels.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/docs-pipeline.yaml:143-156` replaces the suppressed one-liner with a fail-closed block: `set -e`, `task_path="$($spurBin task path $wbs --json \| jq -r '.path // .filePath // empty')"`, and `if [ -z "$task_path" ]; then echo "docs-pipeline: task path did not resolve for wbs $wbs" >&2; exit 1; fi`. No `2>/dev/null`, no `\|\| true`, no forced `exit 0`. The resolved path is written to `.spur/run/$wbs-docs-taskpath.txt`, read into `taskSpecPath` via `file.read.into-var` at `:157-159`, and folded into the digest by both `proof.fingerprint` actions (`taskFile: ${vars.taskSpecPath}` at `:165` and `:201`), so an unresolved wbs can no longer silently degrade the proof to tree-only. `cd packages/app && bun test tests/workflow/docs-pipeline-proof-chain.test.ts` → 4 pass / 0 fail. |
| R2 | MET | `packages/app/tests/workflow/docs-pipeline-proof-chain.test.ts` is the docs-pipeline mirror of `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237`, with four pins: the structural suppression scan (`:32-38`), the empty-path non-zero exit (`:40-45`), the `taskFile:` digest folding (`:47-55`), and a behavioral test (`:57-81`) that renders the command against a stub `emit.sh` returning `{}` and asserts `execSync` throws. `cd packages/app && bun test tests/workflow/docs-pipeline-proof-chain.test.ts` → 4 pass / 0 fail, 11 expect(). |
| R3 | MET | The change removes a bypass rather than adding one, and the removal is pinned: `packages/app/tests/workflow/docs-pipeline-proof-chain.test.ts:32-38` asserts the rendered command contains no `--json 2>/dev/null`, no `\|\| true`, and no trailing `; exit 0`. The pre-existing task-pipeline surface is unchanged — `cd packages/app && bun test tests/workflow/task-pipeline-proof-chain.test.ts` → 12 pass / 0 fail. `bun run spur-check` runs the `sp-runtime-path` and composition gates over the same tree with no suppression. |
| R4 | MET | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-250` now uses the sibling awaited pattern — `const err = await createGitAlternateTree(process.cwd(), undefined, failingExecutor('read-tree')).catch((e) => e); expect(err).toBeInstanceOf(ProofCaptureError);` — matching the immediately following `add failure` test at `:253-258`. `cd packages/app && bun test tests/workflow/proof-input-fingerprint.test.ts` → 11 pass / 0 fail. Non-vacuity proven by mutation: a temporary probe replacing the rejecting call with a stub resolving to the pre-0751 `''` sentinel fails the same assertion with `Expected constructor: [class ProofCaptureError extends Error] / Received value: ""` (probe removed after the run). |
| R5 | MET | `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md:117` "A missing task spec fails the docs-pipeline proof step too", `:123` "The done-state verdict artifact declares the enforced proof binding" (0751 R4 proofBinding enforcement), and `:129` "No new bypass is introduced in the pipeline composition" (0751 R6). `spur feature check D9 --json` echoes all three titles back verbatim, which is exact-label resolution demonstrated by the gate itself. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| docs-pipeline proof fails closed on unresolved task path | MET | test | `cd packages/app && bun test tests/workflow/docs-pipeline-proof-chain.test.ts` → 4 pass / 0 fail. The behavioral pin at `:57-81` renders the real command against a stub resolving to `{}` and asserts `execSync` throws; the structural pins assert the non-zero exit names the unresolved wbs and that `taskSpecPath` still folds into the digest, so no tree-only proof is produced. |
| the R1 git-failure rejection assertion cannot pass vacuously | MET | test | Mutation probe: a temporary test importing `ProofCaptureError` from `packages/app/src/workflow/proof-input-fingerprint` and applying the repaired assertion to `async () => ''` (the pre-0751 sentinel) → `0 pass / 1 fail`, `Expected constructor: [class ProofCaptureError extends Error] / Received value: ""`. The awaited form therefore fails against sentinel-returning code, which the prior un-awaited `expect(...).rejects` form would not have. Against the current code `cd packages/app && bun test tests/workflow/proof-input-fingerprint.test.ts --test-name-pattern "read-tree failure"` → 1 pass / 0 fail. Probe deleted after the run. |
| D9 verify answers cite exact AC labels for 0751 R4 and R6 | MET | command | `spur feature check D9 --json \| jq -r '.[0].findings[].message'` returns the three scenario titles verbatim — "A missing task spec fails the docs-pipeline proof step too", "The done-state verdict artifact declares the enforced proof binding", "No new bypass is introduced in the pipeline composition" — matching `docs/features/D9_…md:117,123,129` character for character, so exact-label matching resolves each citation to a scenario title. |
| A missing task spec fails the docs-pipeline proof step too | MET | test | (D9 ship-contract alias of this task's R1; see task AC checklist `AC-D9a`.) `cd packages/app && bun test tests/workflow/docs-pipeline-proof-chain.test.ts` -> 4 pass / 0 fail. The behavioral pin at `:57-81` renders the real command against a stub resolving to `{}` and asserts `execSync` throws; the structural pins assert the non-zero exit names the unresolved wbs and that `taskSpecPath` still folds into the digest, so no tree-only proof digest is produced. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Count | Notes |
| --- | --- | --- |
| P1 | 0 | No blocking findings. |
| P2 | 0 | — |
| P3 | 0 | — |
| P4 | 0 | The sibling-pattern choice over a generic helper keeps the diff reviewable as one unit and matches 0751's structural precedent; the small duplication of the test describe block is acceptable for the same reason. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET (structurally satisfied by R1's bypass removal) · R4 MET · R5 MET.

**Residual risk** — none for 0760. The pre-existing `applyCliMigrations` bug (0753 Review P4) is unrelated to this slice and tracked separately.

**Final disposition:** done.

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### References

- Task 0751 (S0a: workflow proof fail-closed) — provenance for all three merged findings
- ADR-071 — proof-chain symmetry
- Feature D9 workflow-seam-stabilization-and-proportional-gate-rollout
- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237` — pin template for R2
- docs/04_DESIGN.md — verify-stage AC-label matching contract

### History

- 2026-09-04T15:46:21.536Z todo → wip (system)
- 2026-09-04T15:46:21.966Z wip → testing (system)
- 2026-09-04T15:46:22.373Z testing → done (system)
