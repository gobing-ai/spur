---
schema_version: 1
name: Make history workflow scope normalization deterministic
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.303Z
updated_at: "2026-09-22T02:58:03.042Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w07
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0917"]
---

## 0920. Make history workflow scope normalization deterministic

### Background

history-anatomy currently dispatches a model to validate a declared daily/ad-hoc argument grammar. Fresh analysis, semantic cache keys, independent model validation and atomic publication already exist and must remain. Covers proposed feature R7. Depends on W04's promotion procedure and a history-specific baseline.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W07 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Normalize explicit daily/ad-hoc arguments through the existing deterministic helper boundary with the same selector artifact contract and actionable validation errors.
- [ ] R2. Keep fresh deterministic analysis before the semantic cache probe and retain independent validation, bounded correction and atomic publication.
- [ ] R3. Use declared role/executor/capability policies without assuming a hard-coded agent is present; preserve configured choices and justified freshness.
- [ ] R4. Measure the removed normalization hop through the existing candidate process; report missing telemetry honestly and preserve legacy report readability.

### Acceptance Criteria

- [ ] AC1 — Equivalent valid selectors produce equivalent normalized artifacts without a scope-normalization model call, and invalid combinations fail with named arguments. (req: R1)
- [ ] AC2 — Cache-hit/miss and invalid-enrichment fixtures preserve fresh analysis, independent validation, correction limits and atomic publication. (req: R2)
- [ ] AC3 — Configured executor choices and unsupported-capability failures follow the current declared policy. (req: R3)
- [ ] AC4 — Candidate benefit or insufficiency is recorded without treating heuristic or absent telemetry as measured tokens. (req: R4)
- [ ] AC5 — Diagnostics retain validity with fewer unnecessary model calls (req: R1)

Feature-level traceability: this task delivers D63 scenario R7; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend history-anatomy-cache or another existing owning helper rather than making a new scope service. Date/window/focus syntax is deterministic; open-ended interpretation remains in its existing semantic owner. Do not cache the current analysis or merge enrichment and independent validation. Recheck I81 changes before touching report contracts. The existing default agent and its config override require explicit compatibility treatment, not an unconditional switch.

### Plan

- [ ] 1. Compare the mode reference and existing selector/parser implementations; reuse the grammar owner.
- [ ] 2. Replace model-only explicit argument validation with deterministic normalization and preserve the selector artifact shape.
- [ ] 3. Test daily/ad-hoc conflicts, time-window boundaries, invalid selectors, cache hit/miss, correction cap and publication refusal.
- [ ] 4. Evaluate the candidate with real workflow evidence and update the history skill and generated helper artifacts.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:03.042Z todo → blocked (system)

