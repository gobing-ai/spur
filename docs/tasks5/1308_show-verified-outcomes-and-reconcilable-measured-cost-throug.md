---
schema_version: 1
name: Show verified outcomes and reconcilable measured cost through current run links
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.918Z
updated_at: "2026-11-05T20:43:35.592Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: E6
priority: P2
tags:
  - simplification-2026-11
  - w6
  - approved
estimate_hours: 8

dependencies: []
---

## 1308. Show verified outcomes and reconcilable measured cost through current run links

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W6; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature E6: Outcome feedback reconciles measured cost and verified work.

Owned surfaces/callers/fixtures/config/docs: existing task-run-session links; packages/app workflow/run measurements and history Board service; current history/observability outcome views; transport DTOs and attribution fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Verified-outcome derivation already exists and token attribution intentionally does not price USD. Reuse it; do not rebuild completion proof logic or present token totals as dollars. Recovery UI and planning snapshots are not functional prerequisites.
- Verified source seams: `packages/app/src/services/verified-outcome.ts:92`; `packages/app/src/workflow/run-measurements.ts:21`; `packages/domain/src/analytics/workflow-measurements.ts:36`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

- Additional ready audit: The proposed aggregateRunSamples name is not an existing export. The actual owner is private foldWorkflow in packages/app/src/workflow/run-measurements.ts:95. Reuse/export that existing pure fold within the app workspace, with unchanged existing callers. readWorkflowRuns accepts sinceMs only; filter startedAt <= until in the service before folding so Summary and outcome windows agree. Existing verified outcome counts are task counts, not retry-attempt counts; label them accordingly.

### Requirements

- [ ] R1. Outcome feedback reconciles measured cost and verified work; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Show verified outcomes and reconcilable measured cost through current run links

  Scenario: AC1 — Outcome feedback reconciles measured cost and verified work (req: R1)
    Given known and unknown cost attribution, retries, rework and independently verified task completions
    When the operator opens the existing outcome or history surface
    Then verified outcomes and measured attributable costs reconcile to source totals with an explicit unknown bucket and evidence links
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:07.472Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal ProjectOutcomeService composes deriveVerifiedOutcome with readWorkflowRuns and the existing foldWorkflow (export it within the app workspace without changing its existing callers). Add an existing Observability Summary block, not another tab. Verified completion follows deriveVerifiedOutcome, forced/unproved done remains excluded. Sum measured tokenCostUsd only for exact-mapped rows with non-null persisted USD; show null/unknownCount and measured-row coverage when absent. Display token totals separately; no on-the-fly pricing. Reuse correctionCount/retryExhaustedCount as task counts with those labels, never invented retry-attempt counts; retain excluded/dry-run buckets and current terminal-reason vocabulary. Reuse existing history/observability read contract with an optional outcomes block and bounded current window; no second ledger. Freeze additive optional outcomes in observabilitySummaryResponseSchema: {verified:null|{taskDenominator,verifiedResults,correctionCount,retryExhaustedCount,timeToVerified,excludedReasons}, measuredUsd:number|null,tokens:number|null,terminalRuns:number,mappedRuns:number,historyRows:number,usdRows:number,unknownUsdRows:number,unknownCostRunCount:number,terminalReasonMix:Record<string,number>,gateDurationMs:number|null,gateSampleCount:number,evidence:[{runId:string,wbs:string|null,measuredUsd:number|null,unknownUsdRows:number}],evidenceTruncated:boolean}. Numbers/counts and nested verified shapes follow existing VerifiedOutcomeStat/WorkflowMetrics semantics; declare transport validators in contracts, never import domain types there. Use Summary.window.since/until for both folds; filter readWorkflowRuns.startedAt before folding. unknownUsdRows = historyRows - usdRows; unknownCostRunCount includes terminal non-dry runs with no exact mapping or partially unknown USD. evidence is deterministically sorted by startedAt/runId and capped at 100 with evidenceTruncated; aggregate totals cover the selected window, not just the displayed links. Link existing run/task routes. Gate duration uses only retained quality-gate step start/end timestamps from the same selected runs; sum measured samples, show null/zero samples when unavailable, never substitute whole-run wall time. Add packages/app/tests/services/project-outcome-service.test.ts and apps/web/tests/modules/observability/summary-outcomes.test.ts. Tests must include until-bound exclusion and partially measured USD in addition to empty/unavailable proof.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1309/1311 do not need these UI measurements to build fixture baselines; they are independently preparable.

#### Boundaries and verification

(cd packages/app && bun test tests/services/verified-outcome.test.ts tests/workflow/run-measurements.test.ts tests/workflow/run-cost.test.ts); add ProjectOutcomeService and rendered Summary tests with exact known/unknown totals.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write seeded verified/unverified/forced, retry, ambiguous mapping and null-USD reconciliation fixtures first.
- [ ] 2. Compose existing evidence derivation and measured run stats; never substitute frontmatter done for verification.
- [ ] 3. Render bounded current-window totals with evidence links and explicit unavailable/cost-coverage states.
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
