---
schema_version: 1
name: "Tasks module History-shell parity: unified header, inline filters, full-bleed density, enriched cards"
status: cancelled
template: feature-impl
created_at: 2026-08-25T04:37:58.493Z
updated_at: "2026-08-25T05:09:52.292Z"
feature_id: F72
priority: P2
tags: ["web", "tasks-module", "shell-parity"]
---

## 0662. Tasks module History-shell parity: unified header, inline filters, full-bleed density, enriched cards

### Background

Bring the Tasks board module (apps/web/src/modules/task-kanban/) up to the History module's shell standard per ADR-081 and the design satellite docs/design/tasks-module-shell-parity.md. History (0626) and Observability (J92) established the module-shell convention; Tasks is the first full-bleed instance. Visual design is prototyped in Open Design (project 'tasks-frontend') against root DESIGN.md tokens before React implementation; the artifact is cited as T3 surface evidence in this task.

Implements: R1 — Tasks module renders the one-row shell header with History-parity layout; R2 — Header hosts inline filters with no separate filter section; R3 — Combined input opens the path-WBS popup for a bare four-digit WBS; R4 — Combined input filters subtasks for a dotted WBS; R5 — Combined input falls back to feature substring filtering; R6 — Board body is full-bleed and header-aligned; R7 — Task card surfaces key facts without opening the detail panel; R8 — Filters stay URL-driven and shareable; R9 — Floating and right-dock task detail panel behavior is unchanged; R10 — Workspace embed keeps the headerless board; R11 — Tab strip contract is append-only for future views; R12 — Open Design prototype precedes React implementation.

Rejected split alternative: a separate card-enrichment task (R7) was considered — it edits TaskCard.tsx while the shell work edits TasksShell.tsx/KanbanBoard.tsx — but it scores E1 D1 L1 C0 R0 = 3 (optional at best) and shares the single Open Design prototype and one visual review context with the header work, so it is merged here per cohesion-first sizing (H8 precedent). No other split is cohesion-legitimate: one module, one deliverable, one rollback boundary.

Rubric: E2 D1 L1 C0 R1 = 5 → decomposition considered; D=1 (single reviewable deliverable against one prototype) and cohesion keep it whole; no force-decompose override fires (R not high, E < 16h).

### Requirements

- [ ] R1. Rebuild the tasks route as TasksShell.tsx: one-row header with module icon + name + live chip (from the useTasks store connected flag) on the left and a History-styled tab strip on the right, backed by a new append-only tabs.ts contract exporting TASKS_TABS with exactly one Kanban tab; index.tsx points the module route at TasksShell.
- [ ] R2. Host inline filters in the header row immediately before the tab strip — phase Select (options from api.task.folders), status checkboxes driving lane visibility via hiddenColumns (default hidden: blocked, cancelled), and one combined WBS/feature text input — and delete TaskFilters.tsx and the in-board toolbar row so lane content is the first pixel below the header.
- [ ] R3. Implement the combined-input parse rule: bare /^\d{4}$/ navigates to /board/tasks/<wbs> (existing path-WBS popup), dotted WBS sets the parent filter, anything else sets the feature substring filter; clearing the input clears the param it last set, and all filter state stays URL-driven via useTaskParams (the legacy assignee URL param remains accepted for link compatibility).
- [ ] R4. Make the body full-bleed: no max-w wrapper, header and body share px-4 so lanes align under the header, body is flex-1 overflow-hidden with horizontal lane scroll only when lane count exceeds the viewport.
- [ ] R5. Enrich TaskCard from existing TaskSummary fields only: subtask progress done/total derived client-side by parentWbs grouping (rendered only when total > 0), priority accent as a colored left border resolved through spur-* semantic tokens, and staleness tint on the timestamp when updatedAt is older than 7 days; no assignee chip, no packages/contracts or server changes.
- [ ] R6. Preserve the headerless TaskKanbanView export for the Workspace embed; KanbanBoard gains optional controlled props (folder/onFolderChange, hiddenColumns/onToggleColumn) with uncontrolled in-board defaults, and the embed renders pure lanes (no filter inputs, folder switch, lane toggles, or + New Task button) with card-click detail, drag-and-drop, and live updates unchanged.
- [ ] R7. Leave the TaskDetail floating/right-dock panel's appearance and behavior unchanged (--detail-w persistence, Escape handling, path-WBS auto-popup) and touch no other Board module; stay inside the existing DESIGN.md / .task-kanban token scope (no hex literals, no Tailwind palette classes in module code).
- [ ] R8. Prototype the header and enriched cards in Open Design against root DESIGN.md tokens before React implementation and cite the artifact in this task as T3 surface evidence.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

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

- 2026-08-25T05:09:52.048Z todo → cancelled (system)
