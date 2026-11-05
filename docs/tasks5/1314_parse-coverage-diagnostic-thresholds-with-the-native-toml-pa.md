---
schema_version: 1
name: Parse coverage diagnostic thresholds with the native TOML parser
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-05T20:42:04.393Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: C3
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 3

dependencies: []
---

## 1314. Parse coverage diagnostic thresholds with the native TOML parser

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature C3: Equivalent TOML threshold forms produce equivalent diagnostics.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/quality-gate.ts parseCoverageThreshold and callers; packages/app/tests/services/quality-gate.test.ts; scripts/commands/run-tests.ts native parser precedent.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E3 D1 L2 C0 R1 = 7. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Current helper callers expect null for malformed text and support a root-level legacy snippet. Freeze those behaviors rather than introducing new exceptions or changing the full gate outcome.
- Verified source seams: `packages/app/src/services/quality-gate.ts:172`; `packages/app/tests/services/quality-gate.test.ts:330`; `scripts/commands/run-tests.ts:228`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Equivalent TOML threshold forms produce equivalent diagnostics; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Parse coverage diagnostic thresholds with the native TOML parser

  Scenario: AC1 — Equivalent TOML threshold forms produce equivalent diagnostics (req: R1)
    Given inline and standard-table forms of the same coverage threshold plus absent and malformed settings
    When the quality gate reads coverage diagnostics
    Then valid equivalent forms report the same shortfalls while invalid input is actionable and missing settings retain documented behavior without weakening Bun coverage enforcement
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:20.702Z

Closed: preserve null on malformed/missing settings and the legacy helper snippet; this is diagnostic parsing, not gate-policy tightening.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep parseCoverageThreshold(text):CoverageThreshold|null exactly. Parse with Bun.TOML.parse in try/catch; malformed TOML returns null as today. Prefer [test].coverageThreshold when the test namespace exists; otherwise accept the existing root coverageThreshold helper form. Read only numeric finite axes functions/lines between 0 and 1; absent/invalid axes yield null if none valid. Ignore comments and unrelated namespaces. Do not parse regex text or add a dependency. Keep gateRc nonzero even if diagnostics are unavailable: a failed/unknown diagnostic can never turn a failed gate into PASS. In the existing failed-gate coverage-diagnostic branch, malformed TOML or an explicitly present invalid coverageThreshold must print and persist one bounded bunfig.toml:1 diagnostic explaining that threshold diagnostics are unavailable. Absent settings stay silent. Preserve the public helper null contract; a private parseCoverageThresholdResult(text):{threshold:CoverageThreshold|null,diagnostic:string|null} carries the reason and the public helper delegates to it, so parsing occurs once per caller and null alone does not imply invalid input. Never change the original gate exit status.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent diagnostics fix; no renderer task dependency.

#### Boundaries and verification

(cd packages/app && bun test tests/services/quality-gate.test.ts tests/services/quality-gate-main.test.ts tests/services/quality-gate-receipt.test.ts). No new dependency; no whole coverage-policy rewrite.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write inline/test-table/root-legacy/comment/unrelated-namespace/malformed/invalid-axis cases before replacing the regex.
- [ ] 2. Use native parsing and explicit axis narrowing with the frozen null behavior.
- [ ] 3. Prove valid equivalent forms emit identical shortfall anchors and existing coverage/provenance failures still fail. Include malformed/present-invalid diagnostics and silent absent settings.
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
