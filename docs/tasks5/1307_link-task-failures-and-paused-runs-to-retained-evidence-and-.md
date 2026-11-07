---
schema_version: 1
name: Link task failures and paused runs to retained evidence and safe recovery
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.918Z
updated_at: "2026-11-07T06:53:28.365Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: E71
priority: P2
tags:
  - simplification-2026-11
  - w6
  - approved
estimate_hours: 8

dependencies: ["1306"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1307-verdict.json
---

## 1307. Link task failures and paused runs to retained evidence and safe recovery

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W6; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature E71: Run evidence and valid recovery are reachable from the affected task; Expired scratch is distinguished from durable recovery evidence.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/run-store-service.ts; existing run-record and task-run links; apps/server run/observability read handlers; apps/web/src/modules/observability/TraceTab.tsx and task/run navigation.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- RunStoreService, task-run links, progress and run-record outcomes already exist. Recovery navigation does not require the new readiness panel, so remove the 1302 dependency and reuse existing routes.
- Verified source seams: `packages/app/src/services/run-store-service.ts:77`; `packages/contracts/src/runs.ts:82`; `apps/web/src/modules/observability/TraceTab.tsx:106`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Run evidence and valid recovery are reachable from the affected task; implement the exact Given/When/Then contract below.
- [x] R2. Expired scratch is distinguished from durable recovery evidence; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Link task failures and paused runs to retained evidence and safe recovery

  Scenario: AC1 — Run evidence and valid recovery are reachable from the affected task (req: R1)
    Given one failed and one paused run linked to a task
    When the operator navigates from the task or run to the cause
    Then redacted step evidence and a valid existing recovery action are reachable within two navigation steps without executing the action automatically

  Scenario: AC2 — Expired scratch is distinguished from durable recovery evidence (req: R2)
    Given a completed run whose disposable scratch expired and stale or missing proof fixtures
    When the operator inspects run evidence or recovery eligibility
    Then retained provenance remains usable while expired scratch and invalid proof are explicit and cannot be reused as fresh evidence
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:05.371Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep existing HTTP run/read-record paths and TraceTab. Add a task detail link keyed by wbs to runs/by-wbs, then selected run/state/action display using existing progress/resultSummary. A paused run with existing valid workItem/operator-gate metadata shows its exact existing workflow continue command with required argument placeholders labeled as input, never prefilled as authorized answers. Failed runs show workflow trace plus the task retry command only when current lifecycle permits it; unknown eligibility yields inspection-only guidance. Use current run-record statuses record/incomplete/legacy/oversized for expired/missing evidence messaging; do not equate retained artifact with fresh reusable receipt. No automatic recovery, new run ledger or raw unredacted payload.

#### Dependencies and handoff

Direct prerequisites: 1306. 1306 preserves classified dispatch results and receipt ownership; use its existing fields, no cross-task public DTO invention.

Output/handoff: 1308 can reuse stable evidence links without depending on navigation implementation.

#### Boundaries and verification

(cd packages/app && bun test tests/services/run-store-service.test.ts tests/workflow/run-record.test.ts); (cd apps/server && bun test tests/modules/runs/index.test.ts). Add apps/web/tests/modules/observability/run-recovery.test.ts rendered/HTTP journey.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write task->linked-run->cause navigation fixtures including stale proof and expired scratch before UI changes.
- [x] 2. Expose redacted evidence and legal existing recovery guidance in the current detail/TraceTab surfaces.
- [x] 3. Verify two navigation steps, keyboard activation, wrong-run rejection and inspection-only fallback for unknown eligibility.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Task detail links to the existing Trace tab. Selecting a linked run reads the existing progress, run-detail, and run-record routes and shows redacted cause text plus a copyable recovery command. Nothing on the board calls continue, retry, or any other mutating route. A placeholder `<input>` is never a prefilled answer. Retry text appears only when the current task status is `todo` or `wip`. Unknown lifecycle, a non-failed/non-paused run, an unsafe run id, or a work item for another run stays inspection-only. Run-record statuses stay the current set (`record`, `incomplete`, `legacy`, `oversized`, `missing`), plus `unread` when that read fails. `reusableAsFresh` is always false.

No new HTTP route, CLI verb, plugin script, public DTO, or dependency. `probe: not-applicable (no public surface changed)`.

| Change | Evidence |
| --- | --- |
| Task detail link to `/board/observability?tab=trace&wbs=` | `apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx:7` |
| Link rendered in the task header chips | `apps/web/src/modules/task-kanban/TaskDetail.tsx:231` |
| Shell selects the `tab` query once on mount | `apps/web/src/modules/observability/ObservabilityShell.tsx:20` |
| Trace reads `wbs` and loads `GET /api/runs/by-wbs` outside the time window, plus current task status | `apps/web/src/modules/observability/TraceTab.tsx:341` |
| Expand reads progress, detail, and the run record together | `apps/web/src/modules/observability/TraceTab.tsx:428` |
| Copyable continue, trace, and retry guidance | `apps/web/src/modules/observability/run-recovery.ts:191` |
| Rendered journey: two steps, keyboard, wrong-run rejection, expired scratch, stale proof | `apps/web/tests/modules/observability/run-recovery.test.ts:534` |
| E72 contract names the existing navigation, not a new column | `docs/design/run-record-contract.md:98` |

Focused checks this pass:

- `(cd packages/app && bun test tests/services/run-store-service.test.ts tests/workflow/run-record.test.ts)` — 26 pass, 0 fail, exit 0.
- `(cd apps/server && bun test tests/modules/runs/index.test.ts)` — 15 pass, 0 fail, exit 0.
- `(cd apps/web && bun test tests/modules/observability/run-recovery.test.ts)` — 14 pass, 0 fail, 144 expects, exit 0. happy-dom rendered the journey. A live Board browser was not used; the fixture runs are injected fetch responses, not rows in the project database.
- `bun run --filter @gobing-ai/spur-web typecheck` — exit 0.
- `bunx biome check` on the six changed web files — exit 0, no fixes.
- `bun apps/cli/src/index.ts task gate 1307 light` — format-lint, rules:pre (51 rules), web typecheck, and the web test passed. `rules:post` failed: `.coverage/lcov.info` no longer matches `.coverage/coverage-certification.json` (`lcov-mismatch`). The check names `bun run test:full` as the republish. That full suite belongs to the pipeline gate, so it was not run here. Source edits would also fail this post-check as a stale tree until that suite republishes.

Testing and Review stay empty for the pipeline record and review hops. Status was not changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx:7` `taskRunEvidenceHref` links the task to its run evidence; `apps/web/src/modules/observability/TraceTab.tsx:341` `loadLinked` loads the linked run; `apps/web/src/modules/observability/run-recovery.ts:191` `buildRecovery` offers only valid recovery; apps/web run-recovery + summary-outcomes 19 pass / 0 fail. |
| R2 | MET | `apps/web/src/modules/observability/run-recovery.ts:343` `proofNotice` labels proof state; `apps/web/src/modules/observability/run-recovery.ts:359` `reusableAsFresh = false` so retained evidence is never a fresh receipt; `apps/web/src/modules/observability/run-recovery.ts:390` `missing` (expired scratch) case kept distinct. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Run evidence and valid recovery are reachable from the affected task (req: R1) | MET | test | `apps/web/tests/modules/observability/run-recovery.test.ts:534` keyboard reaches redacted paused evidence in two steps without executing recovery; `apps/web/tests/modules/observability/run-recovery.test.ts:588` failed run shows trace plus retry only while runnable — pass this session. |
| AC2 — Expired scratch is distinguished from durable recovery evidence (req: R2) | MET | test | `apps/web/tests/modules/observability/run-recovery.test.ts:416` evidence and proof are never fresh receipts; `apps/web/tests/modules/observability/run-recovery.test.ts:614` completed run keeps retained provenance and refuses expired scratch and stale proof — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1307

**Scope:** working tree; no `(1307)` commit. Files: `apps/web/src/modules/observability/ObservabilityShell.tsx`, `apps/web/src/modules/observability/TraceTab.tsx`, `apps/web/src/modules/observability/run-recovery.ts`, `apps/web/src/modules/task-kanban/TaskDetail.tsx`, `apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx`, `apps/web/tests/modules/observability/run-recovery.test.ts`, `docs/design/run-record-contract.md`.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | No P1-P3 findings. Six dimensions reviewed on the working-tree diff. Recovery decisions live in one policy module; the Trace panel only renders copyable text and issues read requests. R1 and R2 trace to the rendered journey. | `apps/web/src/modules/observability/run-recovery.ts:191` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx:7` opens Trace; `apps/web/tests/modules/observability/run-recovery.test.ts:534` two-step keyboard journey |
| R2 | MET | `apps/web/src/modules/observability/run-recovery.ts:390` expired scratch stays non-fresh; `apps/web/tests/modules/observability/run-recovery.test.ts:614` |

**Next:** none. Open P1-P3 count is zero.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T06:20:45.147Z todo → wip (system)
- 2026-11-06T06:31:36.096Z wip → testing (system)
- 2026-11-06T06:31:38.228Z testing → done (system)

