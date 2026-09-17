---
schema_version: 1
name: Close the inline trace delegate findings from 0868 review
status: wip
template: feature-impl
created_at: 2026-09-17T17:41:13.059Z
updated_at: "2026-09-17T17:53:22.507Z"
feature_id: D62

---

## 0879. Close the inline trace delegate findings from 0868 review

### Background

Captured from the creation title: "Close the inline trace delegate findings from 0868 review".

### Requirements

- R1: one stdout failure shape for `--action`; finalize vocabulary restricted to the engine's `done`/`failed` (not `running`/`paused`); both trace-failure recorders write the run log in one stamp format (0868 review findings 1, 3, 4).
- R2: an action row whose `node`/`kind` matches no declared state/action surfaces as a `spur workflow progress` diagnostic instead of persisting invisibly (`packages/app/src/workflow/progress-projection.ts`); a finalize for an unobserved action id keeps its run-id attribution (0868 review findings 2, 7).
- R3: the delegate's app-module surface is compile-time linked rather than hand-declared in a cast, so an app signature change fails the delegate's typecheck (`plugins/sp/scripts/inline-run-setup.ts:262-278`; 0868 review finding 5).
- R4 (DECIDED out of scope): ADR-117's `system_events` half for the inline surface is not delivered — `action_runs` + run-row closure satisfy the inline obligation; revisit only when a consumer exists. Record the decision against ADR-117 in `docs/00_ADR.md`.

### Acceptance Criteria

- One test per clause (R1 shape/vocabulary/stamp; R2 diagnostic + attribution; R3 compile-time link).
- R3 verified destructively: changing a linked app signature breaks the delegate's typecheck.
- ADR-117 entry records the inline `system_events` decision; `bun run spur-check` green.

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

- 2026-09-17T17:50:01.362Z backlog → todo (system)
- 2026-09-17T17:53:22.507Z todo → wip (system)

