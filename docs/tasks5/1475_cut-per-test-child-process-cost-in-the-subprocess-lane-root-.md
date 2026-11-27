---
schema_version: 1
name: Cut per-test child-process cost in the subprocess-lane root test files
status: backlog
template: standard
created_at: 2026-11-27T19:06:07.059Z
updated_at: "2026-11-27T19:06:07.447Z"

---

## 1475. Cut per-test child-process cost in the subprocess-lane root test files

### Background

Captured from the creation title: "Cut per-test child-process cost in the subprocess-lane root test files".

### Requirements

- [ ] R1. Measure per-test spawn cost (spur CLI startup, git, bun child) across the 144 subprocess-lane files in config/test-lanes.json and record the top contributors with a receipt.
- [ ] R2. Reduce the dominant cost (e.g. in-process command invocation or a shared warm CLI helper) without weakening assertions, raising timeouts, or moving tests out of the root suite.
- [ ] R3. Record a before/after root-suite wall-time receipt on the same host; context: task 1460 measured the subprocess lane at 286 s alone at width 4 vs a 519 s baseline, so scheduling alone cannot reach the old H161 250 s target.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
