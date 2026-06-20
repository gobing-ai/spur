---
schema_version: 1
name: "New Task slide-out panel feeding the create endpoint"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.367Z
updated_at: 2026-06-20T15:57:13.768Z
feature_id: F7
priority: P1
tags: ["task-kanban", "wave-1", "web", "create", "high-severity"]
---

## 0093. New Task slide-out panel feeding the create endpoint

### Background

Implements gap-analysis §2 (Task Creation — High severity) + Wave 1. Effort: ~8h. Task creation is CLI-only on the migrated board; legacy had a New Task panel with a name input and markdown editors for Background/Requirements. This is a High-severity gap — users cannot create tasks from the web. This task adds a slide-out/modal New Task panel feeding the existing oRPC create endpoint (no new backend route needed). On success the board refreshes and the new task appears in its column. Depends on 0089 (editor dep, for the Background/Requirements fields). Ordering: after 0089.

### Requirements
- [ ] R1. Add a New Task affordance (button) on the board that opens a slide-out or modal panel with a Name input and optional Background/Requirements fields (markdown-capable via the 0089 editor).
- [ ] R2. Submit calls the existing task.create oRPC endpoint; on success the panel closes and the board refreshes (via the useTasks store) so the new card appears without a full reload.
- [ ] R3. Client-side validation: Name is required; surface server validation/lock errors through the existing api-error surface rather than failing silently.
- [ ] R4. The new task lands in the active folder and the correct starting column (backlog/todo per the create semantics); creation is race-safe (the CLI/service already guarantees WBS allocation).
- [ ] R5. Tests: the panel opens/closes, submit invokes create with the entered fields, success triggers a refresh, and a validation error blocks submit. Manual browser check of create→appear recorded in Testing. Gate green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — a New Task affordance opens a creation panel
  Given the board
  When I click "New Task"
  Then a slide-out/modal panel opens with a Name input and optional Background/Requirements fields

Scenario: R2 — submit creates the task and refreshes the board
  Given a filled New Task panel
  When I submit
  Then api.task.create is called with the entered fields
  And on success the panel closes and the board refreshes so the new card appears without a full reload

Scenario: R3 — validation and server errors are surfaced, not swallowed
  Given the New Task panel
  When Name is empty
  Then submit is blocked with a visible validation message
  And a server validation/lock error is surfaced via the api-error event

Scenario: R4 — the new task lands in the active folder and correct column
  Given a successful create
  When the board refreshes
  Then the task appears in its starting column (per create semantics) in the active folder
  And WBS allocation was race-safe (guaranteed by the service)
```

Edge cases (advisory):

```gherkin
Scenario: R5 — Background/Requirements may be omitted
  Given the New Task panel with only a Name
  When I submit
  Then the task is created with just the name (no Background/Requirements content required)
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — a slide-out/modal New Task panel feeding the existing `task.create` route; refresh the `useTasks` store on success. No new backend route.**

`taskCreateInputSchema` already accepts `{ title, featureId?, parentWbs?, folder? }` and `task.create` is wired. So creation is purely a web-side gap — the panel feeds the existing endpoint.

**Panel.** A slide-out (or modal) with a required Name input and optional Background/Requirements fields (markdown-capable via the 0089 editor). Note: `task.create` takes `title` only — it does not accept body content. So the Background/Requirements typed here must either (a) be written via a follow-up `bodyUpdate` (0090) after create, or (b) be deferred. **Chosen:** create with `title`, then if Background/Requirements were entered, issue a `bodyUpdate` to seed the body. Rejected: extending `create` to take body content — `create` stays minimal; composing create + bodyUpdate reuses shipped routes.

**Refresh.** On success, close the panel and trigger the `useTasks` store refresh so the new card appears without a full reload. The store already exposes the refresh path (the poll's `refresh`); reuse it rather than a manual reload.

**Validation/errors (R3).** Client-side: Name required. Server validation/lock errors surface through the existing `api-error` CustomEvent — never silently dropped.

**Active folder.** The panel creates in the active folder (the board's current folder context). Multi-folder selection is 0098's concern; this task creates into whatever folder the board currently shows.

**Depends on:** 0089 (editor dep for the body fields), and optionally 0090 (bodyUpdate to seed Background/Requirements). **Invariant:** WBS allocation race-safety is the service's guarantee, not the panel's — the panel just calls `create`.
### Plan
1. Add a "New Task" button on the board that opens a slide-out/modal panel (Name input + optional Background/Requirements via the 0089 editor).
2. On submit: validate Name is non-empty (block + message otherwise); call `api.task.create({ title, folder: activeFolder })`.
3. If Background/Requirements were entered, follow the create with a `bodyUpdate` (0090) to seed the body.
4. On success: close the panel and trigger the `useTasks` store refresh so the new card appears; on error, surface via the `api-error` event.
5. Tests: panel opens/closes, submit invokes create with the entered fields, success triggers refresh, empty Name blocks submit, server error surfaces. Record a manual browser create→appear check in Testing. Run the gate.
### History
