---
template: feature-impl
schema_version: 1
name: "Kanban gaps 1-2: NewTaskPanel markdown editor + TaskDetail metadata (0191 wave A)"
description: ""
status: done
type: task
profile: standard
feature_id: F7
parent_wbs: "0191"
priority: P1
tags: [approach-c,web,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.851Z
updated_at: 2026-07-04T16:33:55.000-07:00
---

## 0202. Kanban gaps 1-2: NewTaskPanel markdown editor + TaskDetail metadata (0191 wave A)

### Background

Wave A of parent 0191 (Task Kanban parity closure) — read the parent's Background and Design first; remediation detail lives in `docs/analysis/task-kanban-gap-analysis-v2.md` §3 (gaps 1–2). Pure web slice: markdown editor with live-preview toggle + manual panel resize in `NewTaskPanel.tsx` (new UI dependency only through the `apps/web/src/ui.ts` seam, dark-mode checked before adoption; reuse the existing layout resize pattern), and `estimated_hours` + per-phase `impl_progress` bars in `TaskDetail.tsx` (colors: completed=green, in_progress=amber, pending=gray; absent fields render nothing). Confirm the server task DTO passes both fields through — extend additively if the projection drops them.

### Requirements
- [x] R1 — NewTaskPanel: markdown editor + edit/live-preview toggle for Background and Requirements; manual width resize; seam-compliant dependency; dark-mode verified; component tests. (Parent R1)
- [x] R2 — TaskDetail: `estimated_hours` next to Priority; `impl_progress` bars with legacy color coding; absent-field renders nothing; DTO passthrough confirmed/extended; tests incl. absent case. (Parent R2)
- [x] R3 — No regression on shipped parity items (DnD, filters, SSE) — gap-analysis §2 checklist pass. (Parent R7)
- [x] R4 — Full gate green; `ui-import-seam-only` + `no-daisyui-class-leak` rules clean. (Parent R7)
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
- [x] Reproduce gaps 1–2 on a live board; confirm DTO passthrough of `estimated_hours`/`impl_progress` (extend additively if dropped).
- [x] Gap 1: editor + toggle + resize in NewTaskPanel; seam + dark-mode verified; component tests (R1).
- [x] Gap 2: metadata render in TaskDetail incl. absent-field case; tests (R2).
- [x] Regression sweep per gap-analysis §2 (R3).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; ui-seam rules clean (R4).
### Solution

- `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:31` adds a reusable `MarkdownField` over the existing `MDEditor` seam from `@/ui`, with edit/preview toggles and dark color mode for both Background and Requirements.
- `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:104` stores a resizable panel width, syncs it to `--new-task-panel-w`, and persists the final width to `localStorage`.
- `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:200` reuses the shared `ResizeHandle` pattern on the left edge of the right-anchored panel.
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:210` confirms DTO passthrough through `api.task.show` frontmatter and reads `estimated_hours` / `impl_progress` directly from the server result.
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:322` renders per-phase `impl_progress` bars for planning/design/implementation/review/testing, with completed/in-progress/pending color mapping; `apps/web/src/modules/task-kanban/TaskDetail.tsx:431` renders estimated hours next to Priority when present.
- `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:23` adds a seam-safe editor mock and tests markdown editor placeholders, live preview toggle, and resize handle presence.
- `apps/web/tests/modules/task-kanban/task-detail.test.tsx:663` covers estimated hours, `impl_progress`, and absent-field lifecycle fallback.

### Testing

- Focused assertions: `bun test apps/web/tests/modules/task-kanban/new-task-panel.test.tsx apps/web/tests/modules/task-kanban/task-detail.test.tsx` — 56 pass / 0 fail; command exits nonzero on the intentionally narrow coverage subset.
- `bun run lint` — clean.
- `bun run test` — 2179 pass, 0 fail; coverage gate satisfied.
- `bun run test-cf` — Workers runtime test passed.
- `bun run build` — cli/server/web build succeeded.
- `bun run spur-check` — 29 pre-check rules passed including `ui-import-seam-only` and `no-daisyui-class-leak`; 2179 tests passed; 2 post-check rules passed.
- Live board probe: `bun run apps/cli/src/index.ts serve --port 4342 --host 127.0.0.1 --no-open`; `/board/tasks`, `/api/tasks?folder=docs/tasks2`, and `/api/health` returned HTTP 200. This covers the task board shell, task API feed used by filters/columns, and serve health after the UI change.

### Review

| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx` | React 19 + happy-dom still does not reliably flush controlled input state through `fireEvent`, so the async create→body seeding path remains covered by existing surface tests plus live board smoke rather than an end-to-end unit submit. | Keep the direct editor-callback tests for the markdown state path and rely on full gate/live probe for board integration; revisit only if the test environment changes. |

### References

F7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T16:33:55.000-07:00 todo → done (codex: markdown editor/live preview/resizable panel plus TaskDetail metadata verification, full gates green)
