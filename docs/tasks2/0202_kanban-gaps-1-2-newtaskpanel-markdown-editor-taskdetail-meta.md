---
template: feature-impl
schema_version: 1
name: "Kanban gaps 1-2: NewTaskPanel markdown editor + TaskDetail metadata (0191 wave A)"
description: ""
status: todo
type: task
profile: standard
feature_id: F7
parent_wbs: "0191"
priority: P1
tags: ["approach-c", "web", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.851Z"
updated_at: "2026-07-04T04:17:24.311Z"
---

## 0202. Kanban gaps 1-2: NewTaskPanel markdown editor + TaskDetail metadata (0191 wave A)

### Background

Wave A of parent 0191 (Task Kanban parity closure) — read the parent's Background and Design first; remediation detail lives in `docs/analysis/task-kanban-gap-analysis-v2.md` §3 (gaps 1–2). Pure web slice: markdown editor with live-preview toggle + manual panel resize in `NewTaskPanel.tsx` (new UI dependency only through the `apps/web/src/ui.ts` seam, dark-mode checked before adoption; reuse the existing layout resize pattern), and `estimated_hours` + per-phase `impl_progress` bars in `TaskDetail.tsx` (colors: completed=green, in_progress=amber, pending=gray; absent fields render nothing). Confirm the server task DTO passes both fields through — extend additively if the projection drops them.

### Requirements
- [ ] R1 — NewTaskPanel: markdown editor + edit/live-preview toggle for Background and Requirements; manual width resize; seam-compliant dependency; dark-mode verified; component tests. (Parent R1)
- [ ] R2 — TaskDetail: `estimated_hours` next to Priority; `impl_progress` bars with legacy color coding; absent-field renders nothing; DTO passthrough confirmed/extended; tests incl. absent case. (Parent R2)
- [ ] R3 — No regression on shipped parity items (DnD, filters, SSE) — gap-analysis §2 checklist pass. (Parent R7)
- [ ] R4 — Full gate green; `ui-import-seam-only` + `no-daisyui-class-leak` rules clean. (Parent R7)
### Acceptance Criteria
```gherkin
Feature: Task Kanban web parity

  Scenario: New Task panel offers markdown editing with live preview
    Given the New Task panel is open
    When the user toggles live preview on the Background or Requirements editor
    Then the markdown renders in preview mode and the panel width is manually resizable

  Scenario: Task detail shows estimate and implementation progress
    Given a task with estimated_hours and impl_progress in its frontmatter
    When the detail panel loads
    Then the estimate renders next to priority and per-phase progress bars render with status colors
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0191's Design owns the full approach — this slice implements **Gap 1** and **Gap 2** (remediation detail: `docs/analysis/task-kanban-gap-analysis-v2.md` §3): markdown editor + live-preview toggle + manual resize in `NewTaskPanel.tsx` (dependency only via `apps/web/src/ui.ts`; verify dark-mode before adopting; reuse the existing layout resize hook/pattern — don't invent a second); `estimated_hours` + `impl_progress` phase bars in `TaskDetail.tsx` (completed=green, in_progress=amber, pending=gray; absent → render nothing). Confirm the server task DTO passes both frontmatter fields; extend additively if the projection drops them. Regression guard: DnD/filters/SSE untouched (gap-analysis §2 checklist). Depends on: nothing. Independent of 0203.
### Plan
- [ ] Reproduce gaps 1–2 on a live board; confirm DTO passthrough of `estimated_hours`/`impl_progress` (extend additively if dropped).
- [ ] Gap 1: editor + toggle + resize in NewTaskPanel; seam + dark-mode verified; component tests (R1).
- [ ] Gap 2: metadata render in TaskDetail incl. absent-field case; tests (R2).
- [ ] Regression sweep per gap-analysis §2 (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; ui-seam rules clean (R4).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
