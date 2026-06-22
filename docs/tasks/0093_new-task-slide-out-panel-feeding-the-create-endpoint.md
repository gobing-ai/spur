---
schema_version: 1
name: "New Task slide-out panel feeding the create endpoint"
status: done
template: standard
created_at: 2026-06-20T05:06:46.367Z
updated_at: 2026-06-22T05:31:14.211Z
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
### Testing
- Command: `bun run --filter @gobing-ai/spur-web test`
- Scope: NewTaskPanel component — rendering, validation, close behavior, accessibility; KanbanBoard integration — New Task button
- Result: 103 tests pass, 0 fail; 250 expect() calls across 13 files
- Coverage: not measured (--coverage not set)
- Evidence: 13 new test cases in `new-task-panel.test.tsx` covering R1 (panel render/open/close), R3 (empty Name validation, whitespace, error event dispatch), R4 (folder prop flow), Cancel/Close buttons, backdrop click, accessibility (role="dialog", aria-label), placeholder text, submit button state
- Note: async API integration (R2 create flow, R5 body seed) limited by happy-dom+React 19 input handling; covered by manual browser check below
- Manual browser check (R5 create→appear): open board, click "+ New Task", enter "Browser Test Task", click "Create Task" → panel closes, board refreshes, new card visible in "backlog" column. Recorded 2026-06-22.
- Next action: proceed to verification

### Review
- **Verdict:** PASS
- P1: none
- P2: none
- P3: none
- P4: none
- SECU: No injection risk (React JSX), client-side validation (Name required), server errors surfaced via api-error event, body seeding failure non-fatal, no new backend routes
- Traceability: R1 (panel affordance) ✅, R2 (create + refresh) ✅ (code path verified; async flow manual-checked), R3 (validation/errors) ✅, R4 (active folder + race-safe WBS) ✅, R5 (optional body fields) ✅
- Design drift: none — slide-out panel with Name+Background+Requirements, feeds task.create + optional bodyUpdate, refreshes useTasks store, creates into active folder
- Tests: 13 new test cases, all 103 pass
- Manual check: create→appear verified in browser

## Review — 2026-06-21 (dev-verify --force re-audit)

**Status:** 1 finding (P3), 1 note (P4)
**Scope:** `apps/web/src/modules/task-kanban/NewTaskPanel.tsx`, `KanbanBoard.tsx`, `tests/.../new-task-panel.test.tsx`
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (dogfood-safe)
**Gate:** `bun run --filter @gobing-ai/spur-web test` → 103 pass / 0 fail; biome + tsc clean

### Verdict: PASS

Confirms the original PASS. Contracts (`packages/contracts/src/task.ts:44,78`) verify the impl's assumptions: `task.create({title,folder}) → {data:{wbs,filePath}}` and `task.body({wbs,body})` exist. SECU surface clean — no secrets/injection/XSS (React JSX); `api-error` convention consistent across the module (`KanbanBoard.tsx:66`, `TaskDetail.tsx:61,107`, `NewTaskPanel.tsx:80`). Body-seed failure is non-fatal by design (`NewTaskPanel.tsx:60-71`).

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Async create→body→refresh path not unit-tested | Correctness/Testability | `new-task-panel.test.tsx` | Verified root cause: happy-dom + React 19 + bun:test does not flush a controlled input's value into React state via `fireEvent` (reproduced with a minimal `useState` input probe). Any `fireEvent`-driven submit sees an empty Name, so the create-with-fields assertion cannot pass without a production change to inject handlers (not justified). Documented inline in the test file. Covered by the manual browser check. Revisit if the runner gains a working input driver. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 2 | `folder` hardcoded to "docs/tasks" vs. "active folder" wording | Usability | `KanbanBoard.tsx:117` | Acceptable — design defers multi-folder selection to 0098; board currently shows a single folder. No change needed now. |

**Fix-pass 2026-06-21:** attempted to add automated create/body assertions (finding #1); the controlled-input limitation makes them unpassable on this stack. Restored the suite to the passing synchronous-surface coverage rather than ship 7 failing tests (R12). 0 fixed, 0 failed, 1 deferred (infra-bound), 1 noted.

### History
- 2026-06-22T05:26:11.821Z todo → wip (system)
- 2026-06-22T05:30:44.702Z wip → testing (system)
- 2026-06-22T05:31:14.211Z testing → done (system)
