---
schema_version: 1
name: Restore ordinary-suite execution of real-renderer Markdown security proofs
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.912Z
updated_at: "2026-11-05T20:37:40.635Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: H16
priority: P1
tags:
  - simplification-2026-11
  - w0
  - approved
estimate_hours: 4

dependencies: []
---

## 1295. Restore ordinary-suite execution of real-renderer Markdown security proofs

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W0; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature H16: Routine tests execute every isolated Markdown security proof.

Owned surfaces/callers/fixtures/config/docs: apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx; apps/web/tests/lib/markdown-safety.test.ts; apps/web/tests/modules/projects/member-terminal-identity.test.ts as wrapper precedent; ordinary test discovery.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E4 D1 L2 C0 R1 = 8. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The 12-case real-renderer probe is not discoverable; its stated wrapper does not exist. The existing member-terminal wrapper is a concrete isolation/child-JUnit precedent. Keep this proof in the normal suite.
- Verified source seams: `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:11`; `apps/web/tests/modules/projects/member-terminal-identity.test.ts:19`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Routine tests execute every isolated Markdown security proof; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Restore ordinary-suite execution of real-renderer Markdown security proofs

  Scenario: AC1 — Routine tests execute every isolated Markdown security proof (req: R1)
    Given the twelve real-renderer Markdown and Mermaid regression cases outside default discovery
    When the normal test entrypoint runs or a child proof fails or collects zero cases
    Then a discoverable wrapper proves every expected case ran and propagates child failure or missing-proof failure
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:40.350Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New test-only file apps/web/tests/modules/task-kanban/markdown-safety.test.ts. Spawn the current probe once per file with bun test --isolate and a unique JUnit path, using cwd apps/web and explicit tests/setup.ts preload when child config would otherwise omit it. Assert exitCode 0, every expected case title from the current probe, failure count 0 and assertions > 0. Child stderr is printed on failure. Do not pin exactly 1203 assertions or mock Markdown/DOMPurify. Factor the wrapper runner only if a second actual caller can share it without obscuring failure.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1316 uses the proof-discovery safety floor, not a shared production API.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/task-kanban/markdown-safety.test.ts tests/lib/markdown-safety.test.ts); (cd apps/web && bun test --isolate ./tests/modules/task-kanban/markdown-safety-pipeline.tsx). Save the child JUnit and failure-control result.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Read the current 12 test names; write parent failure controls for missing report, zero collected cases and nonzero child exit.
- [ ] 2. Add the discoverable child-proof wrapper and bounded timeout; preserve fixture-process isolation.
- [ ] 3. Run the parent through ordinary discovery and demonstrate that a deliberately failing child fixture fails the parent.
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
