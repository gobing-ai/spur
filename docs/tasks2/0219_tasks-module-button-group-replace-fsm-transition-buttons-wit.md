---
template: feature-impl
schema_version: 1
name: "Tasks module button group: replace FSM-transition buttons with workflow-action buttons"
description: ""
status: done
type: task
profile: standard
feature_id: F7
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-07T00:39:46.536Z"
updated_at: "2026-07-07T01:08:08.181Z"
---

## 0219. Tasks module button group: replace FSM-transition buttons with workflow-action buttons

### Background
The current `TaskDetail.tsx` button group (`STATUS_ACTIONS` mapping at line 10-16) maps **dev-* slash commands** to buttons: `refine`, `plan`, `run`, `verify`, `decompose`, `evaluate`. However, the mapping also **implicitly bundles FSM transitions** — for example, `run` dispatches the pipeline which advances `todo → wip → testing`, and the Cancel button directly calls `onTransition(task.wbs, 'cancelled')`.

The discovery interview for the FeatureDetail redesign (task 0218) surfaced that **status transitions and workflow actions should be separated**. The FSM (`.spur/workflows/task-lifecycle.yaml`) manages lifecycle; buttons trigger work. The current `STATUS_ACTIONS` mapping conflates the two:

- **Workflow actions:** `refine`, `plan`, `run`, `verify`, `decompose`, `evaluate` — these dispatch dev-* commands, status changes are side effects
- **FSM transitions:** The Cancel button directly transitions status — this should be a button like the others, driven by the same mapping

Additionally, there's no `Link Feature` or `Add Subtask` button — useful workflow actions that exist as `spur task` CLI verbs.

**This task aligns the Tasks button group with the same design philosophy that 0218 establishes for Features: centralized action mapping, workflow-first buttons, FSM transitions as explicit actions (not implicit side effects).**
### Requirements
- [x] R1 — Add explicit FSM transition buttons to `STATUS_ACTIONS` so every status change is a visible action: `start` (backlog→todo), `advance` (todo→wip→testing), `complete` (testing→done), `block`/d`unblock`, `reopen` (done→wip). These sit alongside workflow actions, not implicit inside them.
- [x] R2 — Separate the Cancel button from the header and add it to `STATUS_ACTIONS` as `cancel` — a first-class action visible when the status permits cancellation (all non-terminal states). Remove the hardcoded Cancel button rendering.
- [x] R3 — Add `link-feature` button (Links task to a feature by setting `feature_id` frontmatter) — inline feature ID input, then `spur task update` or dedicated API.
- [x] R4 — Add `add-subtask` button (Create child task with `parent_wbs`) — inline title input, then `spur task create --parent <wbs>`.
- [x] R5 — Centralize `STATUS_ACTIONS` and `ACTION_LABELS` extraction if needed (they currently live inline in `TaskDetail.tsx:10-26`). If both TaskDetail and any future consumer need them, extract to `apps/web/src/modules/task-kanban/task-actions.ts`. If only TaskDetail uses them, keep inline but add a comment referencing the design philosophy.
- [x] R6 — Update the action dispatch flow: FSM transition buttons use existing `onTransition` API; workflow buttons use existing `api.task.action` API. No new server endpoints needed (unlike 0218).
- [x] R7 — No regression: DnD, filters, SSE live tail, markdown editor, metadata pane all work unchanged.
- [x] R8 — Full gate green: `bun run lint && bun run test && bun run test-cf && bun run build`; coverage ≥ 90%.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Refined `STATUS_ACTIONS` mapping:**

```typescript
const STATUS_ACTIONS: Record<string, readonly string[]> = {
    backlog: ['refine', 'start', 'cancel'],
    todo: ['plan', 'run', 'decompose', 'add-subtask', 'link-feature', 'block', 'cancel'],
    wip: ['run', 'add-subtask', 'link-feature', 'block', 'cancel'],
    testing: ['verify', 'complete', 'block', 'cancel'],
    blocked: ['refine', 'unblock', 'cancel'],
    done: ['reopen'],
    cancelled: [],
};
```

**Key changes from current mapping:**

| Current | New | Delta |
|---------|-----|-------|
| `todo: [plan, run, decompose]` | `todo: [plan, run, decompose, add-subtask, link-feature, block, cancel]` | +3 actions |
| `wip: [run, verify, evaluate]` | `wip: [run, add-subtask, link-feature, block, cancel]` | `verify`→`testing` only, +block/cancel |
| `testing: [verify, evaluate]` | `testing: [verify, complete, block, cancel]` | +complete/block/cancel |
| `blocked: [refine]` | `blocked: [refine, unblock, cancel]` | +unblock |
| `done` (new) | `done: [reopen]` | New row |
| `cancelled` (new) | `cancelled: []` | New row |

**`evaluate` removed** — it was in the old mapping but had no server-side handler in `api.task.action`. Either add it or drop it; this task drops it.

**Cancel as a first-class action:** Instead of a hardcoded error-variant button, Cancel becomes a `STATUS_ACTIONS` entry. It still opens the confirmation modal; the button rendering logic stays the same.

**File change map:**

| File | Change |
|------|--------|
| `apps/web/src/modules/task-kanban/TaskDetail.tsx` | Update `STATUS_ACTIONS` mapping; add new button handlers; move Cancel into mapping |
| `apps/web/src/modules/task-kanban/task-actions.ts` | NEW (optional) — extract centralized mapping if needed |
| `apps/web/tests/modules/task-kanban/task-detail.test.tsx` | Update tests for new button set |
### Plan
- [x] 1. Audit current `STATUS_ACTIONS` against `.spur/workflows/task-lifecycle.yaml` — confirm every FSM transition has a corresponding button
- [x] 2. Update `STATUS_ACTIONS` mapping to the refined version (new rows for done/cancelled, expanded todo/wip/testing/blocked)
- [x] 3. Add `add-subtask` and `link-feature` inline input dialogs (reuse existing modal pattern)
- [x] 4. Move Cancel into `STATUS_ACTIONS`; remove hardcoded Cancel button rendering; keep confirmation modal
- [x] 5. Add explicit FSM transition buttons: `start`, `complete`, `reopen`, `block`, `unblock`
- [x] 6. Wire `onTransition` for FSM buttons; wire `api.task.action` for workflow buttons (existing APIs)
- [x] 7. Update component tests for new button set
- [x] 8. Full gate: `bun run lint && bun run test && bun run test-cf && bun run build`
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
- 2026-07-07T01:08:07.496Z todo → wip (system)
- 2026-07-07T01:08:07.838Z wip → testing (system)
- 2026-07-07T01:08:08.181Z testing → done (system)
