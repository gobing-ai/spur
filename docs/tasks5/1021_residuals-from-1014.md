---
schema_version: 1
name: Residuals from 1014
status: backlog
template: feature-impl
created_at: 2026-09-30T19:53:23.846Z
updated_at: "2026-09-30T19:53:24.113Z"
feature_id: A9

---

## 1021. Residuals from 1014

### Background

Source task: 1014 (feature A9) — deferred residuals filed by residual-scan settle.

- review-finding:4b231cc1 — plugins/sp/skills/spur-dev/references/execution-batch.md:995: The recipe omits staging: after a conflicted `git merge --no-ff --no-commit <branch>`, each resolved path and every regenerated bundle must be `git add`-ed, or step 4's `git commit -F <message-file>` aborts on unmerged paths. The gap is inherited verbatim from R1's five-step spec (implementation fidelity is correct; the task text itself omits it), it fails loudly and recoverably, and a one-line `git add` comment between steps 3 and 4 fixes it without disturbing the AC1 pattern order.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

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
