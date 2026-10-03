---
schema_version: 1
name: Residuals from 1061
status: backlog
template: feature-impl
created_at: 2026-10-03T01:30:01.825Z
updated_at: "2026-10-03T01:30:02.145Z"
feature_id: F96

---

## 1062. Residuals from 1061

### Background

Source task: 1061 (feature F96) — deferred residuals filed by residual-scan settle.

- review-finding:fc5ed7cf — config/templates/task/standard.md:30, apps/cli/tests/commands/task.test.ts:3696: AC-guidance comment now exists in 7 near-identical copies (6 templates + condensed style-guide form) plus a sed-escaped 8th copy in the 0788 test; only standard.md's copy is contract-pinned, so the other five templates can drift silently — this task's own diff (8 coordinated lockstep edits for one wording change) demonstrates the coupling cost. Follow-up candidate: a cross-template AC-comment consistency check (or generator); full dedup is wrong since templates must stay self-contained for `spur task create` without the plugin.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

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
