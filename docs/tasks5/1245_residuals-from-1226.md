---
schema_version: 1
name: Residuals from 1226
status: cancelled
template: standard
created_at: 2026-10-17T17:18:02.759Z
updated_at: "2026-10-17T17:18:32.417Z"

---

## 1245. Residuals from 1226

### Background

Source task: 1226 (feature A92) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:96c9d2cd — docs/design/sdlc-actions.md:52, plugins/sp/skills/spur-dev/references/gate-checklists.md:179, package.json:93: Live-doc sweep left two residuals of one class. (a) The cross-project survey row still reads `test-pre-check`, `test-post-check` (+ `:full`) for spur-new, while the sibling row was rewritten in this change to attribute `:full` only to superskill/knowledge-kit — spur-new no longer declares either alias. (b) The retargeted transition-shim paragraph now names `spur-check-feature` (correct, and an improvement on the old `spur-check` claim, which never carried the step) but keeps "and before `lint`": `spur-check-feature` has no `lint` step at all. Both are prose only; nothing reads them at gate time.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

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

- 2026-10-17T17:18:31.937Z backlog → cancelled (system)

