---
schema_version: 1
name: Guard WBS allocation against cross-checkout collisions in concurrent batch runs
status: backlog
template: feature-impl
created_at: 2026-10-01T00:47:13.093Z
updated_at: "2026-10-01T00:47:36.303Z"
feature_id: A9

---

## 1036. Guard WBS allocation against cross-checkout collisions in concurrent batch runs

### Background

Captured from the creation title: "Guard WBS allocation against cross-checkout collisions in concurrent batch runs".

### Requirements

- Background: during batch runall-A9-485e, a concurrent agent session in a sibling checkout (i33) allocated overlapping WBS numbers, producing duplicate task IDs (1015/1021-1023 era) that had to be reconciled mid-merge. Hypothesis: WBS allocation is per-checkout with no cross-checkout guard (confirm by running `spur task create --feature X` concurrently from two checkouts of one repo). Cancelled task 1015 held a related one-writer-guard idea.
- Fix direction: cross-checkout allocation guard — either an allocator lock coordinated through the project data dir, or a loud, actionable precheck failure on collision. Smallest mechanism that makes concurrent creation fail loudly or allocate uniquely.
- AC:
  1. Two concurrent `spur task create` runs from two checkouts of the same repo cannot silently allocate the same WBS.
  2. On collision, the error is actionable (names the conflicting checkout/task) rather than silent corruption.
  3. Verified by a repeatable test or documented repro command.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

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
