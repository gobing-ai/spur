---
template: feature-impl
schema_version: 1
name: "Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B)"
description: ""
status: todo
type: task
profile: standard
feature_id: J
parent_wbs: "0189"
priority: P1
tags: ["approach-c", "web", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.849Z"
updated_at: "2026-07-04T04:17:01.966Z"
---

## 0199. Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B)

### Background

Wave B of parent 0189 (Observabilities v1) — read the parent's Background and Design first. This slice delivers the web surface: the `observability` module under `apps/web/src/modules/` (auto-discovery contract, task-kanban as reference), tabs declared as data in `tabs.ts` so later features (Jobs tab from 0190/0201, Process List tab from 0195/0210) append entries without touching the shell, the System Events tab (history fetch + SSE live append), and the Inbox Messages tab (list with thread context). Depends on wave A (0189 wave A APIs: history + inbox read).

### Requirements
- [ ] R1 — `observability` WebModule export, auto-discovered (zero manual wiring); discovery test. (Parent R5)
- [ ] R2 — Tabs-as-data contract in `tabs.ts` (`{id,label,component}[]`), shell maps the array; documented so 0190/0195 append without shell edits. (Parent R6)
- [ ] R3 — System Events tab: initial history fetch + `EventSource('/api/events/planning')` live append (reuse the kanban SSE hook if extractable). (Parent R5)
- [ ] R4 — Inbox Messages tab: sender/recipient/timestamp with `in_reply_to` thread grouping. (Parent R5)
- [ ] R5 — All UI imports via `apps/web/src/ui.ts` (ADR-025, seam rules gate); component tests per task-kanban style; full gate green.
### Acceptance Criteria
```gherkin
Feature: Observabilities board module

  Scenario: Events tab renders history and live tail
    Given the board Observability module is open
    When the operator opens the System Events tab
    Then historical events render and newly fired events append without a page refresh

  Scenario: Inbox tab renders message history
    Given inbox_messages contains messages
    When the operator opens the Inbox Messages tab
    Then messages render with sender, recipient, timestamp, and reply-thread context

  Scenario: Module is auto-discovered by the board
    Given the observability module directory exports a WebModule
    When the board builds
    Then the module appears in the sidebar and routes without manual registry edits
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0189's Design owns the full approach — this slice implements its **Web** paragraph: `apps/web/src/modules/observability/` per the auto-discovery contract (`docs/help/how_to_add_a_new_ui_module.md`; task-kanban is the reference), tabs-as-data in `tabs.ts` (`{id,label,component}[]`, shell maps the array — THE extension contract 0201 and 0210 append to), System Events tab (history fetch → live EventSource append; check whether the kanban's SSE hook is extractable before writing a new one), Inbox tab (thread grouping by `in_reply_to`). All UI imports through `apps/web/src/ui.ts` (ADR-025). Depends on: 0198 (history + inbox APIs). Blocks: 0201's Jobs tab, 0210's Process tab, 0206's live inbox.
### Plan
- [ ] Module scaffold: `WebModule` export + discovery test (R1).
- [ ] Tabs-as-data contract in `tabs.ts`; document the append convention for later tabs (R2).
- [ ] System Events tab: history fetch + SSE live append (R3).
- [ ] Inbox Messages tab: list + thread context (R4).
- [ ] Seam compliance + component tests; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5).
- [ ] Manual: `spur serve` → both tabs render live data.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
