---
schema_version: 1
name: "ADR-130: dated amendment for spur-bin.ts facade accuracy note"
status: backlog
template: feature-impl
created_at: 2026-10-01T00:47:12.874Z
updated_at: "2026-10-01T00:47:36.110Z"
feature_id: A9

---

## 1035. ADR-130: dated amendment for spur-bin.ts facade accuracy note

### Background

Captured from the creation title: "ADR-130: dated amendment for spur-bin.ts facade accuracy note".

### Requirements

- Background: wrap commit fdf0a62b4 edited ADR-130's historical Decision line in place to note that the `spur` binary is a facade (`spur-bin.ts` over apps/cli). The `adr-supersession` rule correctly froze the change (historical lines are immutable; in-place rewrites violate the amendment rule), and the merge (2b10712c9) resolved docs/00_ADR.md as ours — dropping the accuracy note. Verified absent: `rg "spur-bin" docs/00_ADR.md` returns no hits (2026-09-30 17:43).
- Requires operator-authorized scope (project constitution ADR rule): this task is the authorization record; implement only on Robin's go.
- Fix direction: add a dated amendment entry under ADR-130 recording the accuracy note; do NOT edit the historical Decision line in place.
- AC:
  1. docs/00_ADR.md carries a dated amendment for ADR-130 noting the `spur` binary facade accuracy point.
  2. No in-place modification of ADR-130's historical decision text.
  3. `bun run spur-check-feature` passes with adr-supersession green.

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
