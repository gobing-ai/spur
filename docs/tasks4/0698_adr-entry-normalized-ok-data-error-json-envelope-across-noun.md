---
schema_version: 1
name: "ADR entry: normalized ok-data-error JSON envelope across nouns with compat and deprecation story"
status: cancelled
template: feature-impl
created_at: 2026-08-27T19:45:35.221Z
updated_at: "2026-08-27T20:11:34.920Z"
feature_id: F95
priority: P2
---

## 0698. ADR entry: normalized ok-data-error JSON envelope across nouns with compat and deprecation story

### Background

Three times in the 0688 session, inconsistent `--json` shapes broke jq consumers: `task update`'s
`.ok` is `null` where callers expect a boolean; `feature check --json` returns a bare array with
no envelope; `task check --corpus --json` returns flat top-level keys with no `.summary`. F95
exists because this is an ADR-grade, cross-cutting decision; this task carries the decision
record. Public CLI surface change — operator consent per the ADR-051 amendment gates everything
downstream.

### Requirements

- [ ] R1. **Author one dated ADR entry in `docs/00_ADR.md`** proposing the normalized
      `{ok, data, error}` envelope across nouns.
- [ ] R2. **Compat/deprecation story.** Which verbs change shape, how existing consumers migrate,
      what stays back-compat and for how long.
- [ ] R3. **Cite the 0688 evidence** (the three breaks above) as the motivating measurements.

### Acceptance Criteria

- [ ] AC1. The dated ADR entry exists, proposes the envelope across nouns, and carries the
      compat/deprecation story.
- [ ] AC2. The entry's status records that implementation awaits operator consent (ADR-051
      amendment).

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

- 2026-08-27T20:11:34.920Z todo → cancelled (system)
