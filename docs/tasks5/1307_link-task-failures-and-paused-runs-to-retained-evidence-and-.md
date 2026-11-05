---
schema_version: 1
name: Link task failures and paused runs to retained evidence and safe recovery
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.918Z
updated_at: "2026-11-05T20:38:05.661Z"
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

- [ ] R1. Run evidence and valid recovery are reachable from the affected task; implement the exact Given/When/Then contract below.
- [ ] R2. Expired scratch is distinguished from durable recovery evidence; implement the exact Given/When/Then contract below.

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

### Plan

- [ ] 1. Write task->linked-run->cause navigation fixtures including stale proof and expired scratch before UI changes.
- [ ] 2. Expose redacted evidence and legal existing recovery guidance in the current detail/TraceTab surfaces.
- [ ] 3. Verify two navigation steps, keyboard activation, wrong-run rejection and inspection-only fallback for unknown eligibility.
- [ ] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
