---
schema_version: 1
name: Reuse an operation-scoped planning snapshot across corpus readers
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.913Z
updated_at: "2026-11-05T20:37:44.776Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F22
priority: P1
tags:
  - simplification-2026-11
  - w1
  - approved
estimate_hours: 8

dependencies: ["1296"]
---

## 1297. Reuse an operation-scoped planning snapshot across corpus readers

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W1; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F22: Corpus snapshots preserve identifiers and cross-folder relationships.

Owned surfaces/callers/fixtures/config/docs: packages/app task-query/feature/check services; TaskLocator; MarkdownDocument consumers; packages/app planning fixture tests; owning planning contracts and architecture.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Snapshot reuse needs an operation boundary and frozen shape. A singleton/request-spanning cache would change freshness; use an explicitly passed snapshot and keep original public service signatures.
- Verified source seams: `packages/app/src/services/task-query-ops.ts:119`; `packages/app/src/services/feature-service.ts:906`; `packages/app/src/services/task-locator.ts:91`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Corpus snapshots preserve identifiers and cross-folder relationships; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reuse an operation-scoped planning snapshot across corpus readers

  Scenario: AC1 — Corpus snapshots preserve identifiers and cross-folder relationships (req: R1)
    Given registered task folders with aliases, duplicate identifiers, and cross-folder dependencies
    When one operation builds and reuses its parsed snapshot
    Then each relevant file is parsed once and duplicate identifiers and dependencies remain visible with actionable diagnostics
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:44.493Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal services/planning-snapshot.ts exports readPlanningSnapshot({fs, taskDirs, featuresDir?}) and PlanningSnapshot {tasks,features,tasksByWbs,tasksByFeature,dependenciesByWbs,diagnostics,complete}. Record entries contain path, raw, parsed MarkdownDocument and metadata; duplicate WBS produce diagnostics instead of map overwrite. Use taskMetadata for alias/feature-edge normalization. Read each selected file once and reuse within feature refresh, syncAll and check operations; optional private parameters carry the snapshot. Strict public list/derive paths call an assert-complete helper producing the 1296 error. Do not retain snapshots on service instances or reuse after a write; construct a fresh operation snapshot for the next transition/refresh.

#### Dependencies and handoff

Direct prerequisites: 1296. 1296 supplies all-or-error list/derive behavior and PlanningReadError; do not reopen its successful transport contracts.

Output/handoff: 1302 consumes the internal snapshot and existing check results; no public snapshot DTO is promised.

#### Boundaries and verification

(cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/feature-check.test.ts tests/services/task-check.test.ts); add tests/services/planning-snapshot.test.ts with instrumented fs counts and CLI/HTTP golden outputs.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write read/parse-count and cross-folder/duplicate-ID golden fixtures before introducing the helper.
- [ ] 2. Implement operation-scoped snapshot creation using existing locator folder order and parser.
- [ ] 3. Migrate one complete feature refresh/syncAll/check operation at a time, deleting its old scan and preserving stable public outputs.
- [ ] 4. Prove a subsequent read after mutation sees new bytes and no persistent cache or second authority exists.
- [ ] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
