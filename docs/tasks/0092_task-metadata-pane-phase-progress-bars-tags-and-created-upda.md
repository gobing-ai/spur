---
schema_version: 1
name: "Task metadata pane: phase progress bars, tags, and created/updated dates"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.367Z
updated_at: 2026-06-20T06:58:05.444Z
feature_id: F7
priority: P2
tags: ["task-kanban", "wave-1", "web", "metadata"]
---

## 0092. Task metadata pane: phase progress bars, tags, and created/updated dates

### Background

Implements gap-analysis §2 (Task Metadata — Medium) + §3.2 + Wave 1. Effort: ~7h. Legacy had a foldable metadata pane with estimated hours, tags, created/updated timestamps, and phase progress bars; the migrated detail pane shows a flat static text list (priority/feature/file) with no progress indicators or dates. This task builds a metadata pane in TaskDetail.tsx rendering progress through the lifecycle phases, the task's tags, and created/updated dates from frontmatter. Read-only display sourced from the existing show response — extend the contract only if a needed field is absent. Independent of the editor work; can run in parallel with 0091/0092.

### Requirements
- [ ] R1. Render a metadata pane in TaskDetail.tsx showing created_at and updated_at (human-readable), the task's tags, and priority/feature.
- [ ] R2. Render a phase progress indicator reflecting the task's position in the lifecycle (backlog→todo→wip→testing→done) — a progress bar or stepper, derived from the current status.
- [ ] R3. Source all fields from the existing show contract response where present; if created_at/updated_at/tags are not exposed, extend taskShowResponseSchema (transport DTO) and the handler projection minimally to include them — no domain types in contracts.
- [ ] R4. The pane is foldable/collapsible to match the legacy affordance and avoid clutter on small screens.
- [ ] R5. Tests: the pane renders dates, tags, and a progress state for representative statuses; if the contract was extended, a handler test covers the new projection. Gate green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — created/updated dates and tags render in the detail pane
  Given a selected task with created_at, updated_at, and tags in frontmatter
  When the metadata pane renders
  Then the created and updated timestamps are shown human-readable
  And the task's tags are shown

Scenario: R2 — a phase progress indicator reflects the task status
  Given a task at a given lifecycle status
  When the metadata pane renders
  Then a progress bar/stepper shows the task's position in backlog→todo→wip→testing→done

Scenario: R3 — fields are sourced from the existing show response, extended only if absent
  Given the show contract response
  When the pane needs created_at/updated_at/tags
  Then it reads them from frontmatter if present
  And only if absent is taskShowResponseSchema extended (transport DTO) plus the handler projection

Scenario: R4 — the metadata pane is collapsible
  Given the metadata pane
  When I toggle its header
  Then it folds/unfolds, matching the legacy foldable affordance
```

Edge cases (advisory):

```gherkin
Scenario: R5 — a task with no tags or missing dates renders gracefully
  Given a task lacking tags or a date field
  When the pane renders
  Then it omits the missing field without error (no "undefined" leakage)
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — render a collapsible metadata pane in TaskDetail from the `show` response's `frontmatter`; add a status-derived progress stepper; extend the contract only if a field is missing.**

The current detail pane shows a flat list (priority/feature/file). `taskShowResponseSchema` returns `frontmatter` as `z.record(z.string(), z.unknown())`, which already carries `created_at`, `updated_at`, `tags`, `priority` (verified in the created task files). So most fields need no contract change — read them from `frontmatter`.

**Progress indicator.** Derive position from the task's `status` against the canonical order `backlog → todo → wip → testing → done` (+ blocked/cancelled as off-track states). A simple stepper/progress bar — no new data, pure function of status. Rejected: phase-percentage from section completeness — over-engineered; the lifecycle position is the legacy parity ask.

**Dates/tags.** Read `frontmatter.created_at`, `frontmatter.updated_at`, `frontmatter.tags`. Render dates human-readable (e.g. locale date + relative). If a needed field turns out absent from `frontmatter` in practice, extend `taskShowResponseSchema` (transport DTO) and the handler projection minimally — but the record already passes them through, so this is a fallback, not the expected path.

**Collapsible pane.** A foldable section header (matches the legacy foldable metadata panel) to avoid clutter — local UI state, no store involvement.

**Graceful absence (R5).** Missing tags/dates are omitted, never rendered as `undefined`/`null`.

**Independence.** No editor or write path — read-only display. Can land in parallel with 0091. **Invariant:** all data flows from the existing `show` response; the contract is touched only if a field is genuinely missing.
### Plan
1. In TaskDetail (using the `show` response from 0091's fetch, or a dedicated fetch), read `frontmatter.created_at`, `frontmatter.updated_at`, `frontmatter.tags`.
2. Render a collapsible metadata pane: human-readable created/updated dates, tag chips, priority/feature.
3. Add a status-derived progress stepper over `backlog→todo→wip→testing→done` (pure function of `status`); show blocked/cancelled as off-track.
4. Handle missing fields gracefully (omit, no `undefined` leakage).
5. If any field is absent from `frontmatter` in practice, extend `taskShowResponseSchema` + the handler projection minimally (transport DTO only); otherwise no contract change.
6. Tests: pane renders dates/tags and a progress state for representative statuses; missing-field case omits cleanly; if the contract was extended, a handler test covers the projection. Run the gate.
### History
