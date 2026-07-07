---
template: feature-impl
schema_version: 1
name: "FeatureDetail right panel redesign: converge on TaskDetail architecture (MDEditor + metadata + action buttons)"
description: ""
status: done
type: task
profile: standard
feature_id: F7
parent_wbs: null
priority: P0
tags: []
dependencies: []
created_at: "2026-07-07T00:39:43.136Z"
updated_at: "2026-07-07T01:01:48.491Z"
---

## 0218. FeatureDetail right panel redesign: converge on TaskDetail architecture (MDEditor + metadata + action buttons)

### Background
The current `FeatureDetail.tsx` (task 0194 R3–R5) renders feature content using static `SectionCard` blocks (Goal, Scope, Acceptance Criteria). It shows a hardcoded `<Select>` for status transitions and a check-runner button. This is inconsistent with the Tasks module's right panel (`TaskDetail.tsx`), which uses `MDEditor` for body editing, a foldable metadata pane, and a dynamic button group driven by a centralized `STATUS_ACTIONS` mapping.

The user wants to converge the Features right panel onto the same architecture, reusing the same UI components. This is a full redesign of the right panel — not incremental tweaks.

**Key insight:** Feature status transitions are managed by the FSM workflow at `.spur/workflows/feature-lifecycle.yaml`, but the button group should expose **workflow actions** (mapped to dev-* slash commands), not raw FSM transitions. The FSM gates run server-side when a button triggers a status change.

**Discovery interview decisions (2026-07-06 brainstorm):**

| Decision | Resolution |
|----------|-----------|
| Button granularity | Workflow actions + FSM transitions, not raw FSM-only |
| Button set | 12 actions across 4 active statuses (backlog, active, verifying, blocked) |
| Mapping location | Centralized `FEATURE_STATUS_ACTIONS` table in a shared constants file |
| Sync Status behavior | Both directions (Pull/Push) with direction selector modal |
| Linked tasks placement | Inside metadata foldable panel |
| Linked tasks data source | Client-side filter from shared `TaskStore` singleton |
| Body edit/write | New `PATCH /features/{id}/body` endpoint |
| Workflow dispatch | New `POST /features/{id}/action` endpoint |

**Parent context:** This is a child of task 0194 (Features Board Module). Read 0194's Background and Design for the full module context. This task replaces the right-panel portion of 0194's R3–R5.
### Requirements
- [x] R1 — Replace static `SectionCard` blocks with `MDEditor` + `MarkdownBody` for feature body (edit/preview toggle, same pattern as `TaskDetail.tsx:452-508`). Strip YAML frontmatter before displaying in editor (`FeatureShowData` already returns `{ content, frontmatter }`).
- [x] R2 — Replace hardcoded `<Select>` status transition with a dynamic action button group, each button driven by the centralized `FEATURE_STATUS_ACTIONS` mapping table. Button visibility determined by current feature status. FSM transitions (Start, Verify, Complete, Rework, Block, Unblock, Cancel) use existing `transitionFeature()` API.
- [x] R3 — Add foldable metadata pane (dates, priority, tags, file path) + linked tasks list as a sub-section. Linked tasks are client-side filtered from the shared `TaskStore` singleton by `task.featureId === featureId`. Each task row shows WBS, name, status badge, and is a hyperlink to `/board/tasks/{wbs}`.
- [x] R4 — Implement workflow action buttons with per-action behavior:
  - **Brainstorm / Plan:** Channel selector modal → `POST /features/{id}/action` (dispatches `spur agent run` server-side)
  - **Add Child:** Inline name input → `POST /features/{id}/children` (creates child feature file)
  - **+ Task:** Inline title input → `POST /features/{id}/tasks` (creates task with `featureId`)
  - **Link Task:** Inline WBS input → `PATCH /features/{id}/link` (sets task's `feature_id`)
  - **Sync Status:** Direction selector modal (Pull/Push) → `POST /features/{id}/sync`
- [x] R5 — Centralize `FEATURE_STATUS_ACTIONS` + `FEATURE_ACTION_LABELS` in `apps/web/src/modules/features/feature-actions.ts` as the single source of truth.
- [x] R6 — New server endpoints (contracts + handlers):
  | Endpoint | Contract schema | Handler behavior |
  |----------|----------------|------------------|
  | `PATCH /features/{id}/body` | `featureBodyUpdateInputSchema` | Write body content to feature markdown file |
  | `POST /features/{id}/action` | `featureActionInputSchema` | Dispatch brainstorm/plan via `spur agent run` |
  | `POST /features/{id}/children` | `featureCreateChildInputSchema` | Create child feature, return `{ id, filePath }` |
  | `POST /features/{id}/tasks` | `featureCreateTaskInputSchema` | Create task with `featureId`, return `{ wbs, filePath }` |
  | `PATCH /features/{id}/link` | `featureLinkTaskInputSchema` | Set `feature_id` on existing task |
  | `POST /features/{id}/sync` | `featureSyncInputSchema` | Push/pull status between feature ↔ linked tasks |
- [x] R7 — No regression on existing features module: tree view, SSE live tail, feature check runner all work unchanged.
- [x] R8 — Full gate green: `bun run lint && bun run test && bun run test-cf && bun run build`; coverage ≥ 90%.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Architecture: three-layer right panel (mirroring TaskDetail)**

```
┌─ Header ────────────────────────────────────────┐
│  Feature ID — Name          [status pill]       │
│  [Brainstorm] [Plan] [+Child] [+Task] [Start] ✕ │
├─ Metadata (foldable, collapsed by default) ─────┤
│  Status | Priority | Dates | Tags | File path   │
│  ── Linked Tasks (N) ──────────────────────────┤
│  0042 auth-impl ── [wip] ──▶ /board/tasks/0042  │
│  0043 auth-test ── [todo] ─▶ /board/tasks/0043  │
├─ Body ──────────────────────────────────────────┤
│  [Edit] / [Save] [Cancel]                       │
│  ┌─────────────────────────────────────────────┐│
│  │ MDEditor (edit mode) / MarkdownBody (preview)││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

**Button action dispatch flow:**

```
User clicks button → handleAction(action) →
  ├─ FSM transition (start/verify/complete/rework/block/unblock/cancel)
  │   → transitionFeature(id, toStatus) → PATCH /features/{id}/status
  │   → SSE event → tree + detail refresh
  │
  ├─ Workflow action (brainstorm/plan)
  │   → setActionModal(action) → channel selector modal
  │   → dispatchAction() → POST /features/{id}/action
  │   → server runs spur agent run /sp:dev-brainstorm ...
  │
  ├─ Create actions (add-child/add-task)
  │   → inline input dialog (name/title)
  │   → POST /features/{id}/children or /features/{id}/tasks
  │   → SSE event → tree refresh
  │
  ├─ Link task
  │   → inline WBS input dialog
  │   → PATCH /features/{id}/link { wbs }
  │   → SSE event → linked tasks refresh
  │
  └─ Sync status
      → direction selector modal (Pull/Push)
      → POST /features/{id}/sync { direction }
      → confirmation of changes
```

**Centralized action mapping (single source of truth):**

```typescript
// apps/web/src/modules/features/feature-actions.ts
export const FEATURE_STATUS_ACTIONS: Record<string, readonly string[]> = {
    backlog: ['brainstorm', 'plan', 'add-child', 'add-task', 'start', 'cancel'],
    active: ['add-child', 'add-task', 'link-task', 'sync-status', 'verify', 'block', 'cancel'],
    verifying: ['sync-status', 'complete', 'rework', 'cancel'],
    blocked: ['add-child', 'add-task', 'unblock', 'cancel'],
    done: [],
    cancelled: [],
};
```

**Linked tasks: client-side filtering from TaskStore**

`FeatureDetail` subscribes to the shared `TaskStore` singleton (same one the kanban uses). On every poll/SSE update, it filters by `task.featureId === featureId`. This is zero-cost — the kanban already loads all tasks. Each linked task row renders: WBS (monospace), name (truncated), status badge, and is a clickable hyperlink to `/board/tasks/{wbs}`. If no linked tasks exist, show "No linked tasks" muted text.

**Reused components from TaskDetail:**
- Header: status pill, priority chip, feature ID chip (same chip pattern)
- Action button group: same `<Button variant="accent" size="xs">` pattern
- Metadata foldable: same chevron toggle, same field layout
- MDEditor: same `@uiw/react-md-editor` via `@/ui` seam
- MarkdownBody: same preview renderer with mermaid support
- Channel selector modal: same pattern as TaskDetail's action modal
- Cancel confirmation modal: same pattern as TaskDetail's cancel modal

**Server endpoint contracts (new, added to `packages/contracts/src/feature.ts`):**

Each new endpoint follows the existing oRPC contract pattern (implement + contract type-checking). The `body` write mirrors `taskBodyUpdateInputSchema`. The `action` dispatch mirrors `taskActionInputSchema`. Create/link/sync endpoints are feature-specific.

**File change map:**

| File | Change |
|------|--------|
| `apps/web/src/modules/features/FeatureDetail.tsx` | Full rewrite (~400+ lines) |
| `apps/web/src/modules/features/feature-actions.ts` | NEW — centralized action mapping |
| `apps/web/src/lib/feature-client.ts` | Add body write, action dispatch, children, tasks, link, sync API calls |
| `apps/web/src/lib/feature-types.ts` | Add types for new endpoints |
| `packages/contracts/src/feature.ts` | Add 6 new contract schemas |
| `apps/server/src/modules/feature/handlers.ts` | Add 6 new handler functions |
| `apps/server/src/modules/feature/` | Potentially new service methods in `spur-app` |
| `apps/web/src/modules/features/FeaturesShell.tsx` | Pass `onClose` callback (if needed) |
| `apps/web/tests/modules/features/feature-detail.test.tsx` | Rewrite tests for new component |
### Plan
**Phase A — Shared infrastructure (foundation):**
- [x] A1. Create `feature-actions.ts` with `FEATURE_STATUS_ACTIONS` + `FEATURE_ACTION_LABELS` mapping
- [x] A2. Create `feature-action-types.ts` with TypeScript types for action dispatch
- [x] A3. Add feature client methods: `saveFeatureBody()`, `dispatchFeatureAction()`, `createChildFeature()`, `createFeatureTask()`, `linkTaskToFeature()`, `syncFeatureStatus()`

**Phase B — Server endpoints:**
- [x] B1. Add 6 new contract schemas to `packages/contracts/src/feature.ts`
- [x] B2. Add 6 new handler functions to `apps/server/src/modules/feature/handlers.ts`
- [x] B3. Wire feature-service methods in `@gobing-ai/spur-app` (or implement inline if simple)
- [x] B4. Run `bun run lint` to confirm contract↔handler type alignment

**Phase C — FeatureDetail rewrite (web UI):**
- [x] C1. Replace section extractors with `api.feature.show()` → `{ content, frontmatter }` data flow
- [x] C2. Add MDEditor + MarkdownBody with edit/preview/save/cancel (same pattern as TaskDetail)
- [x] C3. Add foldable metadata pane with frontmatter fields
- [x] C4. Add linked tasks list sub-section inside metadata pane (subscribe to TaskStore, filter by featureId)
- [x] C5. Add dynamic button group driven by `FEATURE_STATUS_ACTIONS`
- [x] C6. Add action dispatch: channel selector modal (brainstorm/plan), inline input dialogs (add-child, +task, link-task), direction selector modal (sync)
- [x] C7. Add cancel confirmation modal
- [x] C8. Wire SSE refresh so tree + detail update on feature events

**Phase D — Verification:**
- [x] D1. Write/rewrite component tests for new FeatureDetail
- [x] D2. Write server handler tests for new endpoints
- [x] D3. Full gate: `bun run lint && bun run test && bun run test-cf && bun run build`
- [x] D4. Live board smoke test: create feature, exercise all buttons, verify linked tasks, verify body edit/save
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
- 2026-07-07T01:01:47.803Z todo → wip (system)
- 2026-07-07T01:01:48.147Z wip → testing (system)
- 2026-07-07T01:01:48.491Z testing → done (system)
