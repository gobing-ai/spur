---
schema_version: 1
name: "Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs"
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:38.595Z
updated_at: "2026-10-02T23:30:48.864Z"
feature_id: D63

---

## 1060. Wrapup drift probe: classify doc-owned surfaces against the feature span, not per-task diffs

### Background

Session evidence (wrap run `fb334c41…`, 2026-10-02): wrapup task-resolve routed dirty solely because task 1055's diff touched `plugins/sp/skills/code-implementation/SKILL.md` (doc-owned surface `plugins/sp/skills/**`), even though the owning design-doc sync (`fdb7882cd`, planning-workflow-contracts change-map row) had already landed in the same feature span. The probe inspects per-task diffs, so span-wide syncs force a manual extra hop. Current fail-safe direction (unknown/parse failure routes dirty) must be preserved.

### Requirements

1. The drift probe's changed-path set becomes span-scoped (batch base..merged tip for runall runs, or the feature span when `vars.feature` is set) instead of the union of per-task diffs.
2. A doc-owned surface touch whose owning sync already exists in-span routes clean (fast wrapup) instead of dirty.
3. Fail-safe preserved: any lookup, parse, or path-resolution failure still routes dirty and never silently clean.

### Acceptance Criteria

- AC1: a wrapup run whose span contains a `plugins/sp/skills/**` touch plus its in-span design-doc sync routes clean; test or dry-run evidence recorded.
- AC2: a span with the touch but no owning sync still routes dirty; test evidence recorded.

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
