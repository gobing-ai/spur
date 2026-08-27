---
schema_version: 1
name: "CLI JSON envelope standard: ADR, shape inventory, and gated implementation in one task"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.932Z
updated_at: "2026-08-27T20:19:54.509Z"
feature_id: F95
priority: P2
---

## 0693. CLI JSON envelope standard: ADR, shape inventory, and gated implementation in one task

### Background

Three times in the 0688 session (2026-08-27), inconsistent `--json` shapes broke jq consumers: `task update`'s `.ok` is `null` (file state is truth) where callers expect a boolean; `feature check --json` returns a bare array (observed live during the 2026-08-27 filing); `task check --corpus --json` returns flat top-level keys with no `.summary`. jq consumers broke 3× in that session and the bare-array shape bit again during the filing. This is an ADR-grade, cross-cutting public-surface change: everything lands in ONE task behind a mid-task HITL consent gate (ADR-051 amendment) before implementation begins.

### Requirements

- [ ] R1. **ADR entry** in `docs/00_ADR.md` proposing the normalized `{ok, data, error}`
      envelope across nouns, with a compat/deprecation story, citing the 0688 breaks as the
      motivating evidence.
- [ ] R2. **Per-noun shape inventory** into `docs/04_DESIGN.md` — current top-level shapes for
      every noun's `--json` verbs, each deviation from the envelope named.
- [ ] R3. **HITL consent gate:** implementation starts only after the operator approves the ADR
      decision mid-task (ADR-051 amendment — public CLI surface change).
- [ ] R4. **Implement the envelope** behind the gate, per the approved decision.

### Acceptance Criteria

- [ ] AC1. The dated ADR entry exists with the proposal, the compat/deprecation story, and the 0688 evidence.
- [ ] AC2. The inventory section exists in docs/04_DESIGN.md covering all nouns and naming every deviation from the proposed envelope.
- [ ] AC3. Given no operator approval, when the task reaches implementation, then it stops at the mid-task HITL consent gate.
- [ ] AC4. Given operator approval, when the envelope ships, then the affected nouns emit `{ok, data, error}` per the decision.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
