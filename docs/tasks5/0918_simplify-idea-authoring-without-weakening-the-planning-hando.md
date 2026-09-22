---
schema_version: 1
name: Simplify idea authoring without weakening the planning handoff
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.302Z
updated_at: "2026-09-22T02:58:00.918Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w05
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914", "0917"]
---

## 0918. Simplify idea authoring without weakening the planning handoff

### Background

idea-pipeline has separate feature-intent and AC model authoring as well as design, decomposition and ready preparation. The safe candidate is adjacent authoring consolidation, not removal of human design decisions or evidence-bound handoff. Covers proposed feature R5. Depends on W01 and W04's completed promotion procedure; needs an idea-specific baseline.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W05 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E8 D1 L2 C1 R1 = 13. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Use an idea-specific baseline to determine whether consolidating feature-intent and AC authoring removes measurable redundant model work.
- [ ] R2. Preserve verbatim intake and requirement coverage, feature structural checks, explicit design decisions and the corpus CLI write boundary.
- [ ] R3. Preserve task dependency ordering, preparation digest validity and the single honest refineall/runall handoff.
- [ ] R4. Use the established candidate deadline and real-evidence promotion process, with rejection/retirement if parity or benefit is unproven.

### Acceptance Criteria

- [ ] AC1 — The selected change cites an idea-specific baseline and demonstrates its model-hop benefit on comparable real runs, or remains unpromoted. (req: R1)
- [ ] AC2 — All input clauses reach the intended feature/task scope and invalid AC or unresolved design decisions prevent handoff. (req: R2)
- [ ] AC3 — Dependency updates preserve valid preparation evidence and exactly one correct next-command handoff is emitted. (req: R3)
- [ ] AC4 — Parity, failure-path coverage and candidate disposition are recorded with no standing parallel idea workflow. (req: R4)
- [ ] AC5 — Planning preserves intent through handoff (req: R1)

Feature-level traceability: this task delivers D63 scenario R5; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Prefer one coherent authoring artifact containing feature intent and AC, then existing deterministic CLI mutations and validation. Keep semantic design judgment and operator decisions distinct. Do not turn ready preparation into a blind shape check or fuse it across mutations that invalidate its digest. The proposal does not remove freshness policies across independent planning roles; any changed session boundary must be measured and justified within the candidate.

### Plan

- [ ] 1. Baseline current idea stages and map intake clauses through existing feature/task/handoff evidence.
- [ ] 2. Define the combined authoring artifact and cheap validation using existing helper ownership.
- [ ] 3. Exercise ambiguity, rejected design, omitted requirements, invalid AC, dependency mutation and preparation/handoff cases.
- [ ] 4. Compare authorized real runs and promote or retire through the W04 method; update dev-idea/dev-plan and their owning skills.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:00.918Z todo → blocked (system)

