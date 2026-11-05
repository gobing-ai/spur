---
schema_version: 1
name: Share executor result finalization while preserving receipts and partial work
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-05T20:38:03.557Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: D65
priority: P2
tags:
  - simplification-2026-11
  - w5
  - approved
estimate_hours: 8

dependencies: ["1305"]
---

## 1306. Share executor result finalization while preserving receipts and partial work

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W5; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature D65: Executor results share truthful finalization and failure context.

Owned surfaces/callers/fixtures/config/docs: AgentRunActionRunner result paths; existing receipt/host-resume/fleet-result handling; failure classification, usage and redaction helpers; executor matrix fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Receipt writing is already shared by execute/recordReceipt. Do not create a second finalizer or duplicate failure classification. Share repeated post-condition/freshness result preparation around the existing one writer, preserving the host receipt exception.
- Verified source seams: `packages/app/src/workflow/actions/agent-run.ts:587`; `packages/app/src/workflow/actions/agent-run.ts:598`; `packages/app/src/services/failure-classification.ts:6`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Executor results share truthful finalization and failure context; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Share executor result finalization while preserving receipts and partial work

  Scenario: AC1 — Executor results share truthful finalization and failure context (req: R1)
    Given success, refusal, timeout, cancellation, contract failure and partial-work fixtures on each executor surface
    When execution finishes or the host resumes from its receipt
    Then shared finalization preserves freshness, usage, redaction and ownership while recording a classified failure and evidence without duplicating policy
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:03.257Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep execute -> dispatch -> recordReceipt as the sole nonhost receipt path. Add private finalizeAgentDispatchResult(invocation,result) only for common post-condition/result decoration proven repeated; use existing contractViolation, receiptOutcomeOf, redaction and failure-classification helpers. Host pause returns its workItem with no action-owned receipt; host continue retains validation ownership. Fleet fallback retains fallbackReason and subprocess executor attribution, late fleet writes remain fenced, first failure is not masked by a secondary receipt-write failure. Preserve existing result.data fields, outcome vocabulary and telemetry; any normalized diagnostic is additive internal data, not a new public enum.

#### Dependencies and handoff

Direct prerequisites: 1305. 1305 freezes private invocation data and a behavior matrix; do not repeat or change its admission decisions.

Output/handoff: 1307 reads preserved resultSummary/outcome/fallback metadata; it must not depend on an invented new public failure enum.

#### Boundaries and verification

(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/host-executor.test.ts tests/services/workflow-host-executor.test.ts). Real-agent dogfood is separately reported; fake process fixtures must prove containment without external agent availability.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write completion matrix for success/refusal/timeout/cancel/contract failure, missing receipt and resumed/late results.
- [ ] 2. Extract repeated completion decoration into the existing path; retain surface exceptions and one receipt writer.
- [ ] 3. Compare full result/receipt/redaction golden outputs and source policy delta before removing the old branches.
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
