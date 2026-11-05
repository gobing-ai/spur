---
schema_version: 1
name: Remove unsupported runtime registration promises from the Board registry
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-05T20:38:23.096Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A8
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 3

dependencies: []
---

## 1315. Remove unsupported runtime registration promises from the Board registry

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A8: Board extension operations no longer promise unsupported registration.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/registry.ts and tests/modules/registry.test.ts; registry callers, contribution composition and public Board declaration exports; configured React/iframe fixture tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E3 D1 L2 C0 R1 = 7. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The current caller search finds only registry implementation/exports and its tests. The public Board declaration source is contribution.ts, not Registry. Freeze removal of the unused internal method rather than leaving a compatibility choice to implementation.
- Verified source seams: `apps/web/src/modules/registry.ts:20`; `apps/web/tests/modules/registry.test.ts:90`; `scripts/commands/emit-board-types.ts:20`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Board extension operations no longer promise unsupported registration; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Remove unsupported runtime registration promises from the Board registry

  Scenario: AC1 — Board extension operations no longer promise unsupported registration (req: R1)
    Given the runtime registration stub, its caller inventory and configured contribution fixtures
    When the extension surface is simplified using the existing composition owner
    Then no callable operation silently claims a rescan and supported configured React and iframe contributions retain their behavior and compatibility
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:22.805Z

Closed: remove the unused internal operation. A newly introduced production consumer is source drift, not an open design option.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Remove registerModuleRoot from Registry, createRegistry return, and the module-level export; remove only the two tests asserting a no-op. Do not change disableModule/enableModule/order/default behavior or contribution composition. Update comments/docs that promise runtime rescans. Recheck public declaration source and production callers at implementation start; if a new real consumer has appeared, stop and report drift instead of making an unrequested break. Do not build a replacement loader. No dependency on transport task 1300.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent internal cleanup; no public contribution ABI change.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts); run declaration emit check and typecheck. Use installed Board fixtures where required, not a new loader.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write a compatibility proof of current registry operations and configured React/iframe composition before deleting the stub.
- [ ] 2. Reconfirm only tests consume registerModuleRoot and the public Board declaration does not expose it.
- [ ] 3. Remove the inert method/exports/no-op tests and stale promise; verify no unresolved imports and unchanged contributions.
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
