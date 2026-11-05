---
schema_version: 1
name: Unify executor admission and invocation policy across existing dispatch surfaces
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-05T20:38:01.440Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: D65
priority: P2
tags:
  - simplification-2026-11
  - w5
  - approved
estimate_hours: 8

dependencies: []
---

## 1305. Unify executor admission and invocation policy across existing dispatch surfaces

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W5; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature D65: Executor surfaces apply the same declared admission contract.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/workflow/actions/agent-run.ts; existing host-executor/fleet-dispatch helpers; capability, independence and agent-budget helpers; receipt and agent-run fixture tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Current dispatch branches have intentionally different observable guarantees: host returns a work item before subprocess-only capability/budget checks. Do not pretend every old policy already applies identically. Remove unrelated Board/search prerequisites and freeze a behavior-preserving extraction first.
- Verified source seams: `packages/app/src/workflow/actions/agent-run.ts:633`; `packages/app/src/workflow/actions/agent-run.ts:905`; `packages/app/src/workflow/actions/agent-run.ts:311`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Executor surfaces apply the same declared admission contract; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Unify executor admission and invocation policy across existing dispatch surfaces

  Scenario: AC1 — Executor surfaces apply the same declared admission contract (req: R1)
    Given equivalent host, fleet and subprocess work items including unsupported capability, stale artifact, reviewer identity and exhausted-budget fixtures
    When each existing surface evaluates admission
    Then common declared policy produces equivalent justified decisions while surface-specific identity and host-pause semantics remain explicit
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:01.150Z

Closed: preserve observable behavior; unify only shared semantics. A stronger enforcement guarantee would require a separately designed change, not this refactor.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Private internal NormalizedAgentInvocation holds validated input/role/cwd/session option, declared file contracts, selected surface and existing flags; normalize pure option shape once. Retain current routing order/pinning/fleet fallback and host pause point. Extract common artifact-freshness and declared-shape validation only where existing branch behavior matches; model native capability/usage checks as surface capabilities rather than asserting a host session offers subprocess enforcement. Preserve existing unsupported outcomes and distinct-executor checks. No public ActionRunner/API changes, no new requirements on the host, no executor registry. Add a matrix documenting equal common-contract decisions and intentional surface-specific differences before deleting duplicated blocks.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1306 consumes private normalized invocation and behavior matrix; it owns completion, not admission policy.

#### Boundaries and verification

(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/host-executor.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/fleet-dispatch.test.ts). Save admission matrix with intentional surface differences.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write admission matrix covering actual host/fleet/subprocess branches, pinning, stale artifacts and negative capability/independence cases.
- [ ] 2. Introduce private normalization and extract proven common checks while retaining surface-specific order and effects.
- [ ] 3. Delete replaced duplicated blocks and prove no subprocess spawns on host pause or new host-control guarantee is claimed.
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
