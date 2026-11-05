---
schema_version: 1
name: Prove migration SQL ownership and offline upgrade parity on fixtures
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-05T20:40:03.544Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A331
priority: P3
tags:
  - simplification-2026-11
  - w7
  - conditional
estimate_hours: 6

dependencies: []
---

## 1311. Prove migration SQL ownership and offline upgrade parity on fixtures

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W7; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A331: Migration ownership evidence decides whether embedding consolidation is safe.

Owned surfaces/callers/fixtures/config/docs: packages/domain/src/migrations.ts; active drizzle migrations; installed engine schema SQL exports; CLI build embedding and migration fixture tests; vendors and legacy reference remain read-only.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The runtime migration journal records id and applied_at, not SQL checksums. Preserve hashes as audit evidence, not a fictitious enforced DB field. Remove the W6 UI dependency; fixture evidence is runnable now.
- Verified source seams: `packages/domain/src/migrations.ts:1407`; `packages/domain/src/migrations.ts:2046`; `packages/domain/src/migrations.ts:1305`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Migration ownership evidence decides whether embedding consolidation is safe; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Prove migration SQL ownership and offline upgrade parity on fixtures

  Scenario: AC1 — Migration ownership evidence decides whether embedding consolidation is safe (req: R1)
    Given fresh, previous-release, migrated, interrupted and duplicate-column database fixtures
    When the current embedded and tracked migration paths are compared without real-data writes
    Then a versioned repeatable artifact inventories SQL ownership, released identifiers and offline behavior and records an explicit go or no-go decision
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:21.467Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Keep backlog pending measured maintenance benefit after W6. This task proves safety and proposes a source; it does not authorize a new dependency or a real database migration.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:14.092Z

Closed: fixture evidence can begin now. Runtime checksums are not invented, and historical SQL is not rewritten.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Evidence-only. Freeze candidate 0037_spur_cli_history_dimension_marts and HISTORY_DIMENSION_MARTS_SCHEMA_SQL. Compare tracked SQL with the embedded constant after SQL-aware whitespace/comment normalization while retaining exact SHA-256 for both originals. Inventory other mirrors but do not propose their migration in this slice. Verify 55 current IDs (0000..0054) from CLI_MIGRATIONS dynamically rather than assuming counts, guard metadata and journal order. Reuse migration fixture suite for fresh/previous/interrupted/already-applied and absent-column cases; no real database. Artifact docs/reports/1311-migration-ownership.md + JSON {schemaVersion:1,candidate:"0037-dimension-marts",status:"go"|"no-go"|"inconclusive",ids,hashes,semanticParity,guardParity,offlineProof,reason}. Go requires unchanged released SQL, semantic equivalence and preserved offline/guard behavior; no upstream dependency change. Both report formats must include sourceRevision (git HEAD), sourceDigests (SHA-256 keyed by each inspected source path), fixture seed and repeatable command; the downstream task rejects evidence if a named source digest changes, even on the same HEAD.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1312 consumes the exact 0037 decision and hashes; no external package release is needed.

#### Boundaries and verification

(cd packages/domain && bun test tests/dao/migrations.test.ts); add a fixture ownership/parity proof and use the existing CLI build path for a disposable source-free smoke when available. Preserve all legacy reference files read-only.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Snapshot migration IDs/guard metadata and exact file/embedded hashes before any proposed change.
- [ ] 2. Run fixture upgrade/idempotence and source-free baseline proof, recording binary/runtime/package provenance.
- [ ] 3. Publish the fixed candidate decision artifact and explicitly distinguish audit hashes from runtime journal fields.
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

- 2026-11-05T20:02:21.178Z todo → blocked (system)
- 2026-11-05T20:38:14.680Z blocked → todo (system)

