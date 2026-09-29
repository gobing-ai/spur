---
schema_version: 1
name: Feature refresh skip-reason fidelity and feature-side --fix fence coverage (1008 P3-1/P3-4)
status: done
template: feature-impl
created_at: 2026-09-29T18:18:16.889Z
updated_at: "2026-09-29T20:35:34.111Z"
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

- **R1 (skip-reason fidelity)** — every refresh skip names the root cause. `assertFenceBalance` (`packages/domain/src/planning/markdown-document.ts:398`) throws inside `replaceMarkerRegion` for three distinct states — a doc-level unclosed fence **anywhere** (not only inside the Tasks body), duplicate top-level sections (1008 R3b), and a new body with an unclosed fence — and the blind catch at `packages/app/src/services/feature-service.ts:388-392` labels all of them `no-tasks-marker-region`. Classify before writing, in this precedence: `doc.unclosedFenceLine() !== null` → `unclosed-code-fence`; `doc.duplicateSectionNames.length > 0` → `duplicate-sections`; `!doc.hasSection('Tasks')` → `missing-tasks-section`; `replaceMarkerRegion` throw → `no-tasks-marker-region`. The fence check runs **before** `hasSection`, so a fence that hides the Tasks heading (opens above it) is also reported as `unclosed-code-fence` — the same corruption must not get two labels depending on where the fence opens.
- **R2 (feature-side --fix coverage)** — extend the feature fence test (`apps/cli/tests/commands/feature.test.ts:413-436`) with a `--fix` leg mirroring the task-path test (`apps/cli/tests/commands/task.test.ts:922-948`): after `feature check <id> --fix`, the file still contains the fence text and a re-check still reports `L2.unclosed-code-fence`. `FeatureCheckService.check` calls `applyStructuralRepairs(rawSource, 'feature', …)` directly (`packages/app/src/services/feature-check.ts:219`), so this guards the feature call site, not just the shared engine.
- **R3 (contract doc)** — `docs/design/data-output-contracts.md:204` still documents `feature refresh` as `{index_path, tasksUpdated}`; it has been stale since 1008 R4 added `skipped`. Update the row to `{index_path, tasksUpdated, skipped: [{id, reason}]}` with the four reason values. (`docs/04_DESIGN.md` carries no refresh contract — not the owner.)

### Acceptance Criteria

- [x] AC1 — `packages/app/tests/services/feature-service.test.ts` covers all four reasons: fence above the Tasks heading → `unclosed-code-fence` (the existing 1008 R4 test's expectation moves from `missing-tasks-section`); fence opening inside/after the Tasks body → `unclosed-code-fence`; duplicate top-level section → `duplicate-sections`; balanced doc with Tasks but no marker region → `no-tasks-marker-region`; balanced doc with no Tasks heading → `missing-tasks-section` (req: R1)
- [x] AC2 — The feature fence test runs `feature check --fix` and asserts the fence text survives and `L2.unclosed-code-fence` is still reported; `rmSync` cleanup stays in `finally`; targeted run green (req: R2)
- [x] AC3 — `docs/design/data-output-contracts.md` feature/refresh row lists `skipped: [{id, reason}]` and the four reason values (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T19:53:30.223Z

- **Q: Scope of the mislabel?** Closed (verification 2026-09-29): wider than the review stated. `assertFenceBalance` checks the doc-level fence state, so a fence opening in ANY section after the Tasks heading is mislabeled, and a duplicate-section document is mislabeled too. Fence opening above Tasks yields `missing-tasks-section` — also a symptom label. All three are fixed by pre-classification.
- **Q: Change the 1008 R4 test expectation (`missing-tasks-section` → `unclosed-code-fence`)?** Closed: yes. The fixture is literally an unclosed fence; the root-cause label is the R4 intent ("make the corruption observable"). Reason names keep their meanings — only fence-caused skips move to the precise label.
- **Q: Add `duplicate-sections`?** Closed: yes — same bug class (catch mislabel), same one-line classification via the existing public `duplicateSectionNames` getter; leaving it mislabeled would need a follow-up of this exact task.
- **Q: CLI change?** Closed: none. `apps/cli/src/commands/feature.ts` passes `result.skipped` through to JSON and prints `id`/`reason` generically.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

1. `packages/app/src/services/feature-service.ts:382-392` — replace the `hasSection` + blind catch with ordered classification:

   ```ts
   const reason =
       doc.unclosedFenceLine() !== null
           ? 'unclosed-code-fence'
           : doc.duplicateSectionNames.length > 0
             ? 'duplicate-sections'
             : !doc.hasSection('Tasks')
               ? 'missing-tasks-section'
               : undefined;
   if (reason !== undefined) {
       skipped.push({ id: feature.id, reason });
       continue;
   }
   try {
       doc.replaceMarkerRegion('Tasks', table);
   } catch {
       skipped.push({ id: feature.id, reason: 'no-tasks-marker-region' });
       continue;
   }
   ```

   Update the R4 comment and the `refresh()` JSDoc `@returns` to list the four reasons. No new parsing — both getters exist (1008 R1/R3b).
2. `packages/app/tests/services/feature-service.test.ts` — reuse `seedRefreshCorpus()`; flip the existing R4 expectation to `unclosed-code-fence`; add cases for fence-after-Tasks, duplicate section, balanced-no-marker, and no-Tasks-heading.
3. `apps/cli/tests/commands/feature.test.ts:413-436` — after the finding assertions: `await main(['feature', 'check', id, '--fix'], …)`, assert file text still contains `never closed`, re-run `check --json` and assert the fence finding persists. Keep `rmSync(featurePath)` in `finally`.
4. `docs/design/data-output-contracts.md:204` — refresh row shape + reasons (same commit).

Constraints (anti-drift):

- Do NOT change L2 emission, `assertFenceBalance`, or `--fix` behavior.
- No CLI source change, no new flags, no server change (task 1011).
- `ac_altitude: task-local` stays.

Verify: `(cd packages/app && bun test tests/services/feature-service.test.ts)`, `(cd apps/cli && bun test tests/commands/feature.test.ts)`, then `bun run spur-check`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/feature-service.ts:383-398` — classification precedes the write, in the exact specified precedence: `doc.unclosedFenceLine() !== null` → `unclosed-code-fence` (:383-384), `doc.duplicateSectionNames.length > 0` → `duplicate-sections` (:387-388), `!doc.hasSection('Tasks')` → `missing-tasks-section` (:391-392), `replaceMarkerRegion` throw → `no-tasks-marker-region` (:396-398). Fence check runs before `hasSection` (:383 < :391), so a fence hiding the Tasks heading gets the root-cause label regardless of where it opens |
| R2 | MET | `apps/cli/tests/commands/feature.test.ts:431-438` — `feature check <id> --fix` leg asserts fence text survives (`toContain('never closed')`, :433), re-check exits 1 (:435-436) and still reports `L2.unclosed-code-fence` (:437-439); `rmSync` cleanup retained in `finally` (:441, :445) |
| R3 | MET | `docs/design/data-output-contracts.md:204` — feature/refresh row updated to `{index_path, tasksUpdated, skipped: [{id, reason}]}` with the four reason values enumerated, tagged (1009 R1) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/feature-service.test.ts:343` (fence above Tasks heading → `unclosed-code-fence`), :358 (fence opened after the Tasks body/EOF → `unclosed-code-fence`), :369 (duplicate top-level section → `duplicate-sections`), :380 (Tasks without auto-gen markers → `no-tasks-marker-region`), :393 (balanced doc, no Tasks heading → `missing-tasks-section`) — all four reasons covered via the `corruptA` helper (:337-342); targeted run green (56 pass, receipt sha256:460e172a…) |
| AC2 | MET | test | `apps/cli/tests/commands/feature.test.ts:431-438` (--fix leg, fence text survives, re-check reports `L2.unclosed-code-fence`, exit 1), `rmSync` in `finally` (:441-445); targeted run green (48 pass) |
| AC3 [docs-only] | MET | static-ref | `docs/design/data-output-contracts.md:204` — row lists `skipped: [{id, reason}]` and all four reason values |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1009

**Scope:** diff `89d51ac..worktree` — `packages/app/src/services/feature-service.ts`, `packages/app/tests/services/feature-service.test.ts`, `apps/cli/tests/commands/feature.test.ts`, `docs/design/data-output-contracts.md`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | `refresh()` JSDoc `@returns` still lists only two skip causes; Solution step 1 required updating it to the four reasons | `packages/app/src/services/feature-service.ts:351` |
| 2 | P4 (advisory) | correctness | Bare `catch` classifies any `replaceMarkerRegion` throw as `no-tasks-marker-region`; only marker-missing is reachable today, but future domain guards would be silently misclassified | `packages/app/src/services/feature-service.ts:397` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Four-way classification in exact precedence order `unclosedFenceLine` → `duplicateSectionNames` → `hasSection` → `catch` (`feature-service.ts:394-411`); each reason has a dedicated test: fence-above-Tasks → `unclosed-code-fence` (`feature-service.test.ts:368`), fence-at-EOF-after-Tasks → `unclosed-code-fence`, never a write (`:378`), EOF `## Notes` dup → `duplicate-sections` (`:388`), markers stripped → `no-tasks-marker-region` (`:397`), balanced-no-Tasks → `missing-tasks-section` (`:405`) |
| R2 | MET | CLI test extends the 1008 R2 leg with `--fix`: asserts `never closed` survives (`feature.test.ts:431`), re-check exits 1 with `L2.unclosed-code-fence` still present (`:433-437`); `rmSync` cleanup stays in the existing `finally` |
| R3 | MET | Contract row updated to `skipped: [{id, reason}]` with the four reason values (`data-output-contracts.md:204`) |

##### Dimension Summaries

**Functional:** AC1/AC2/AC3 each satisfied exactly as specified, including the fence-above-Tasks case landing on `unclosed-code-fence` and the "never a write" guarantee proven by the fence-at-EOF test. The duplicate test is non-vacuous: the feature template ships `## Notes` (`feature-service.ts:1014`), so the EOF append creates a genuine parse-time duplicate.

**Correctness:** classification reads the same parse state the domain guard throws on — `unclosedFenceLine()` and `duplicateSectionNames` are the fields `assertFenceBalance` checks (`markdown-document.ts:398-416`) — so service-level skip classification cannot diverge from `replaceMarkerRegion`'s own protection. No P1–P3 correctness findings.

**Security:** `--fix` not auto-closing fences is a data-integrity safeguard and is now regression-tested; no new trust boundary or injection surface in the diff.

**Efficiency:** the two new checks are O(body) scans on a doc already read and parsed in the same loop iteration; the EOF-fence test additionally proves an avoided write (no serialize + atomic write on the skip path).

**Usability:** skip reasons are actionable strings, contract-documented with an ∈-closed vocabulary; stale JSDoc is the only usability gap (P3).

**Architecture:** classification lives in the app service using domain getters (no new domain surface — right layer); server parity with the open `reason` string is deliberately deferred to 1011 per the contract note, so no union-type coupling finding. Test placement is correct: classification matrix in `packages/app/tests/services`, `--fix` policy in `apps/cli/tests/commands`; the shared `corruptA` helper deepens the corpus-mutation tests. Contract doc ownership matches the task's stated owner (`data-output-contracts.md`, not 04_DESIGN.md).

**Next:** fix the `refresh()` JSDoc `@returns` to list the four reasons (one-line follow-up, rides with 1011); optionally tighten the `catch` to match the marker-missing error.

### References

- Review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-1, P3-4)
- Code: `packages/app/src/services/feature-service.ts:382-392` · `packages/domain/src/planning/markdown-document.ts:366` (`duplicateSectionNames`), `:377` (`unclosedFenceLine`), `:398` (`assertFenceBalance`), `:574` (`replaceMarkerRegion`) · `packages/app/src/services/feature-check.ts:219` · `apps/cli/tests/commands/feature.test.ts:413-436` · `apps/cli/tests/commands/task.test.ts:922-948` · `packages/app/tests/services/feature-service.test.ts:333-350`
- Contract: `docs/design/data-output-contracts.md:204`
- Tasks: 1008 (R2/R3b/R4), 1011 (server parity; open `reason` string) · Feature: F91

### History

- 2026-09-29T20:05:28.662Z backlog → todo (system)
- 2026-09-29T20:13:52.184Z todo → wip (system)
- 2026-09-29T20:33:12.194Z wip → testing (system)
- 2026-09-29T20:35:34.111Z testing → done (system)

