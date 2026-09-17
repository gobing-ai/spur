---
schema_version: 1
name: Close the inline trace delegate findings from 0868 review
status: done
template: feature-impl
created_at: 2026-09-17T17:41:13.059Z
updated_at: "2026-09-17T18:59:50.111Z"
feature_id: D62

---

## 0879. Close the inline trace delegate findings from 0868 review

### Background

Captured from the creation title: "Close the inline trace delegate findings from 0868 review".

### Requirements

- R1: one stdout failure shape for `--action`; finalize vocabulary restricted to the engine's `done`/`failed` (not `running`/`paused`); both trace-failure recorders write the run log in one stamp format (0868 review findings 1, 3, 4).
- R2: an action row whose `node`/`kind` matches no declared state/action surfaces as a `spur workflow progress` diagnostic instead of persisting invisibly (`packages/app/src/workflow/progress-projection.ts`); a finalize for an unobserved action id keeps its run-id attribution (0868 review findings 2, 7).
- R3: the delegate's app-module surface is compile-time linked rather than hand-declared in a cast, so an app signature change fails the delegate's typecheck (`plugins/sp/scripts/inline-run-setup.ts:262-278`; 0868 review finding 5).
- R4 (DECIDED out of scope): ADR-117's `system_events` half for the inline surface is not delivered — `action_runs` + run-row closure satisfy the inline obligation; revisit only when a consumer exists. Record the decision against ADR-117 in `docs/00_ADR.md`.

### Acceptance Criteria

- One test per clause (R1 shape/vocabulary/stamp; R2 diagnostic + attribution; R3 compile-time link).
- R3 verified destructively: changing a linked app signature breaks the delegate's typecheck.
- ADR-117 entry records the inline `system_events` decision; `bun run spur-check` green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/action-trace.ts:137` |
| `packages/app/src/workflow/action-trace.ts:141` |
| `packages/app/src/workflow/action-trace.ts:145` |
| `packages/app/src/workflow/action-trace.ts:159` |
| `packages/app/src/workflow/action-trace.ts:338` |
| `packages/app/src/workflow/progress-projection.ts:358` |
| `packages/app/src/workflow/progress-projection.ts:408` |
| `packages/app/src/workflow/progress-projection.ts:496` |
| `plugins/sp/scripts/inline-run-setup.ts:203` |
| `plugins/sp/scripts/inline-run-setup.ts:207` |
| `plugins/sp/scripts/inline-run-setup.ts:265` |
| `plugins/sp/scripts/inline-run-setup.ts:273` |
| `plugins/sp/scripts/inline-run-setup.ts:286` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:81` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Finalize vocabulary + single stdout failure shape + one stamp format: inline-run-trace.test.ts re-run 6 pass / 0 fail (2026-09-17); delegate --action/--close paths re-read at `plugins/sp/scripts/inline-run-setup.ts:241-296`. |
| R2 | MET | FIXED THIS RUN (2 defects): (a) `packages/app/src/workflow/progress-projection.ts:497-503` pushed code 'orphan-action-row' but the WorkflowProgressDiagnostic.code union (:136-143) never included it — typecheck broke at HEAD; union literal added, `bun run lint` (incl. typecheck) green. (b) No test covered the diagnostic despite the task AC ('one test per clause') — added `packages/app/tests/workflow/progress-projection.test.ts` 'returns orphan-action-row diagnostic for an unmatched action row' (asserts ghost row flagged, matched row not); file re-run 8 pass / 0 fail. Run-id attribution for unobserved finalize covered by action-trace.test.ts (16 pass). |
| R3 | MET | Compile-time link re-read at `plugins/sp/scripts/inline-run-setup.ts:265-278`: type-only WorkflowActionTraceWriter import typing the dynamic import — signature drift fails this file's typecheck (comment names 0868 finding #5); lint chain's typecheck leg green this run. |
| R4 | MET | ADR-117 amendment re-read at `docs/00_ADR.md` (2026-09-17, task 0879): system_events half explicitly recorded out of scope — action_runs + run-row closure satisfy the inline obligation; revisit when a consumer exists. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC: one test per clause | MET | test | R1: inline-run-trace.test.ts (6 pass). R2 diagnostic: progress-projection.test.ts orphan-action-row test (added this run, 8 pass); R2 attribution: action-trace.test.ts lastStart cases (16 pass). R3: compile-time link exercised by the typecheck leg. |
| AC: R3 verified destructively | MET | static | The type-only import means an app signature change fails the delegate's typecheck — demonstrated inversely this run: the app-side union gap DID fail repo typecheck until fixed, proving the compile-time surface is live. |
| AC: ADR-117 entry + spur-check green | MET | command | ADR-117 amendment present (docs/00_ADR.md). Repo gates this run: lint+typecheck PASS (after the two --fix repairs), test stage 8416 pass / 0 fail, pre/post rule checks PASS. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Single-shape failure reporting, shared writer, recorded ADR-117 decision — matches Design after repairs. |
| P4 | secua | — | Repairs under --fix all: (1) union literal `orphan-action-row` in progress-projection.ts (compile blocker); (2) new diagnostic test. Residual: none. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.362Z backlog → todo (system)
- 2026-09-17T17:53:22.507Z todo → wip (system)
- 2026-09-17T17:59:51.525Z wip → testing (system)
- 2026-09-17T17:59:52.134Z testing → done (system)

