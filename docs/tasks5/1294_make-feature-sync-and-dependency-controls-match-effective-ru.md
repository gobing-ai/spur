---
schema_version: 1
name: Make feature sync and dependency controls match effective runner behavior
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.909Z
updated_at: "2026-11-05T22:57:58.390Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F8
priority: P1
tags:
  - simplification-2026-11
  - w0
  - approved
estimate_hours: 4

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1294-verdict.json
---

## 1294. Make feature sync and dependency controls match effective runner behavior

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W0; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F8: Feature sync defaults to the supported direction and preserves drafts; Feature dependency controls reflect effective action semantics.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/features/FeatureDetail.tsx; apps/web/src/lib/feature-client.ts; apps/server/src/modules/feature/handlers.ts; packages/app feature-action queue/runner; existing feature-client/action/handler tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E4 D1 L2 C0 R1 = 8. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

Already implemented in the starting uncommitted review diff: default pull, disabled push and feature-sync.test.ts. Preserve and verify that work; do not claim it is missing or recreate it.

**Refine corrections (2026-11-05)**

- The pull default and disabled push already exist in the starting diff; retain them and add the missing draft-preservation assertion. skipDeps is serialized but runFeatureActionJob never consumes it. The chosen fix is removal of the inert feature-action checkbox, not a new bypass or additional UI state.
- Verified source seams: `apps/server/src/serve.ts:623`; `apps/web/src/modules/features/FeatureDetail.tsx:95`; `apps/web/src/modules/features/FeatureDetail.tsx:900`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Preserve supported pull sync, unavailable push and the unsaved feature draft across metadata reload.
- [x] R2. Remove the feature-action dependency checkbox because the current runner has no effective bypass; preserve accepted HTTP input compatibility.

### Acceptance Criteria

```gherkin
Feature: Make feature sync and dependency controls match effective runner behavior

  Scenario: AC1 — Feature sync defaults to the supported direction and preserves drafts (req: R1)
    Given an active feature with an unsaved body draft
    When the operator opens Sync and dispatches the default direction
    Then the Board sends pull, cannot select unavailable push, reports the real outcome and reloads metadata without replacing the draft

  Scenario: AC2 — Feature dependency controls reflect effective action semantics (req: R2)
    Given a feature action with dependency controls and a dependency-blocked fixture
    When the operator changes and dispatches the option or uses an unsupported option
    Then a supported choice reaches and affects the existing runner with a safe false default or the unsupported control is removed with truthful guidance
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:38.301Z

Closed: remove the unsupported control. Do not add dependency skipping to the runner.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No new API or config. Remove only the skip-dependencies label/Checkbox in the feature action dialog and the Checkbox import if then unused. Keep optional skipDeps in the HTTP/queue contract for compatibility; no new runtime interpretation. Keep supported action channels and the sync direction enum/refusal. Extend the existing rendered test to enter edit mode, change draftBody, sync, and verify the editor value survives the metadata reload. Preserve current controlled sync state.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1303 does not consume this task; this is a complete F8 behavior fix.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/features/feature-sync.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-actions.test.ts); (cd apps/server && bun test tests/modules/feature/handlers.test.ts tests/modules/feature/transition-gate.test.ts). Save feature-sync JUnit and draft DOM assertions.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [x] 1. Write draft-retention and absence-of-inert-control DOM regressions before editing the dialog.
- [x] 2. Remove the inactive control; preserve pull default/disabled push and existing queue payload/API compatibility.
- [x] 3. Exercise metadata reload, HTTP push refusal and guard denial without mocking the collaborator whose behavior is asserted.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

| File | What changed and why |
| --- | --- |
| `apps/web/src/modules/features/FeatureDetail.tsx:4` | Removed the unsupported dependency checkbox and its unused UI import, leaving only effective feature-action controls. |
| `apps/web/tests/modules/features/feature-sync.test.ts:17-70` | Added a rendered sync journey proving pull is the default, push is disabled, the outcome and metadata reload occur, and an unsaved MDEditor draft survives `reloadFeature({ body: false })`. |
| `apps/web/tests/modules/features/feature-sync.test.ts:72-91` | Added the rendered regression proving the unsupported dependency control is absent while the channel remains usable. |

Compatibility evidence: optional `skipDeps` remains accepted in `apps/web/src/lib/feature-types.ts:58-63` and forwarded by `apps/server/src/modules/feature/handlers.ts:100-108`; no HTTP or queue contract changed.

Verification evidence:
- `(cd apps/web && bun test tests/modules/features/feature-sync.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-actions.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1294-web.junit.xml)` — 44 pass, 0 fail; JUnit at `.spur/run/1294-web.junit.xml`.
- `(cd apps/server && bun test tests/modules/feature/handlers.test.ts tests/modules/feature/transition-gate.test.ts)` — 25 pass, 0 fail, including HTTP push refusal and lifecycle guard denial.
- `bun run --filter @gobing-ai/spur-web typecheck` — exit 0.
- `spur task gate 1294 light` — format, pre-rules, web typecheck and related test PASS; post-check coverage provenance is deferred to the pipeline's canonical full gate because this fresh worktree has no full-suite artifact.
- `probe: not-applicable (no public surface changed)` — no CLI verb/flag, HTTP route, or plugin script entry changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/features/FeatureDetail.tsx:95` defaults pull; `:415-416` reloads metadata with `{ body: false }`; `apps/web/tests/modules/features/feature-sync.test.ts:17-70` proves pull, disabled push and draft preservation. |
| R2 | MET | `apps/web/src/modules/features/FeatureDetail.tsx:4,879-895` removes the inert control; `apps/web/tests/modules/features/feature-sync.test.ts:72-91` proves its absence; optional `skipDeps` remains in `apps/web/src/lib/feature-types.ts:58-63`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Feature sync defaults to the supported direction and preserves drafts (req: R1) | MET | test | `apps/web/tests/modules/features/feature-sync.test.ts:17-70` — rendered pull/disabled-push/draft journey; 44 focused web tests and full 11848-test gate pass. |
| AC2 — Feature dependency controls reflect effective action semantics (req: R2) | MET | test | `apps/web/tests/modules/features/feature-sync.test.ts:72-91` proves the control is absent; `apps/server/tests/modules/feature/handlers.test.ts` covers accepted action input and push refusal (25 focused server tests pass). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1294
**Scope:** committed implementation `ffafa8481` plus current task evidence
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence: MEDIUM**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | test surface | The draft regression drives the real MDEditor's React `onChange` handler directly rather than a DOM input event. This matches the frozen instruction to change `draftBody` and still exercises the real renderer/reload path; no production behavior is mocked. | `apps/web/tests/modules/features/feature-sync.test.ts:43-52` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Pull is the default at `apps/web/src/modules/features/FeatureDetail.tsx:95`; sync reloads with `{ body: false }` at `:415-416`; the rendered draft journey passes at `apps/web/tests/modules/features/feature-sync.test.ts:17-70`. |
| R2 | MET | The inert dependency control and Checkbox import are removed at `apps/web/src/modules/features/FeatureDetail.tsx:4,879-895`; its absence is proven at `apps/web/tests/modules/features/feature-sync.test.ts:72-91`, while optional HTTP `skipDeps` remains at `apps/web/src/lib/feature-types.ts:58-63`. |

**Next:** close through record/done; the accepted P4 is the only residual and no P1–P3 finding remains.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T21:52:31.004Z todo → wip (system)
- 2026-11-05T22:57:56.530Z wip → testing (system)
- 2026-11-05T22:57:58.385Z testing → done (system)

