# Task Kanban Gap Analysis v2: Legacy vs. Modern UI & Implementation

**Date:** June 22, 2026  
**Analyst:** Antigravity AI Coding Assistant  
**Workspace:** `gobing-ai/spur` (`~/xprojects/spur-new`)

---

## 1. Visual Overview (Side-by-Side Comparison)

![Legacy Kanban Board View](/Users/robin/.gemini/antigravity-ide/brain/f56d596c-2872-4fb1-a35d-77ea92b494d4/legacy_board_view_1782163339527.png)
<!-- slide -->
![Modern Kanban Board View](/Users/robin/.gemini/antigravity-ide/brain/f56d596c-2872-4fb1-a35d-77ea92b494d4/modern_board_full_1782164197755.png)
<!-- slide -->
![Legacy Task Detail Panel](/Users/robin/.gemini/antigravity-ide/brain/f56d596c-2872-4fb1-a35d-77ea92b494d4/legacy_detail_panel_1782163356028.png)
<!-- slide -->
![Modern Task Detail Panel](/Users/robin/.gemini/antigravity-ide/brain/f56d596c-2872-4fb1-a35d-77ea92b494d4/modern_board_detail_1782164210002.png)


---

## 2. Structural & Feature Parity Checklist

The newly migrated task kanban board in `spur-new` has achieved a high degree of parity, but several user interface and server-side gaps remain.

| Feature Area | Legacy (`cc-agents`) | Modern (`spur-new`) | Status / Remaining Gap |
| :--- | :--- | :--- | :--- |
| **New Task Creation Panel** | Slide-out panel. Uses markdown `@uiw/react-md-editor` for **Background** and **Requirements** with a **Live Preview** toggle. Width is manually resizable via a drag handle. | Slide-out panel (`NewTaskPanel`). Uses standard textareas without markdown editor/preview. Static width (`w-96`), not resizable. | 🔶 **Partial**<br>Need markdown editor for Background & Requirements + resize handle. |
| **Task Details Panel** | Slide-out panel. Manually resizable width. Shows `estimated_hours` (Estimate). Displays multi-phase **Implementation Progress** bars based on `impl_progress` in frontmatter. | Integrated RightPanel layout. Width resizable via layout handle. Renders phase progress based on lifecycle status. Does not render `estimated_hours` or `impl_progress` bars. | 🔶 **Partial**<br>Need `estimated_hours` render + detailed `impl_progress` bars. |
| **Workflow Actions** | Clicking buttons like *Refine, Plan, Verify, Decompose, Evaluate* opens a modal to select the agent channel (claude, codex, etc.) and a checkbox to `skip dependencies`, then invokes the orchestrator CLI synchronously. | Clicking buttons triggers an immediate POST to `/tasks/{wbs}/actions`. However, only `run` is implemented in the server Hono handler. Clicking other buttons throws a `404 Action not implemented` error. | 🔶 **Partial**<br>Need modal/popover to choose channel + skipDeps, and server support for all actions. |
| **Drag & Drop** | `@hello-pangea/dnd`. Smooth visual animation during drag and drop. | `@dnd-kit/core` + `DragOverlay`. Fluid and responsive. | ✅ **Complete** |
| **Filtering & Columns** | Custom filtering by status, feature, parent WBS. Toggling column visibility. Column sorting by WBS. | Standard `TaskFilters` panel, column checkboxes, sorting controls (ascending/descending) on columns. | ✅ **Complete** |
| **SSE Sync Connection** | EventSource SSE updates with live connection status indicator dot (green/red) in header. | EventSource SSE connection with `connected ? 'Live' : 'Polling'` indicator (green/red dot). | ✅ **Complete** |

---

## 3. Detailed Gap Remediation Strategy

### Gap 1: New Task Markdown Editor & Resizability
The legacy task creation panel offers a premium markdown editing experience with live rendering. The current `NewTaskPanel` is too simple and static.
- **Remediation:** 
  1. Replace the plain `textarea` fields in `NewTaskPanel.tsx` with `@uiw/react-md-editor` component instances.
  2. Implement the "Live Preview" / "Edit Only" toggler matching the legacy look.
  3. Change the panel overlay structure to support manual width resizing with the same hover handles as the main board.

### Gap 2: Detailed Progress and Estimated Hours in Details Panel
Legacy task metadata shows a grid of `Estimate: Xh` and `impl_progress` phase-by-phase status bars.
- **Remediation:**
  1. Update `TaskDetail.tsx` to read `estimated_hours` from frontmatter and render it next to Priority.
  2. Read `impl_progress` from frontmatter (if present) and render the progress bars for `planning`, `design`, `implementation`, `review`, and `testing` sections with dynamic color-coding (`completed` = green, `in_progress` = amber, `pending` = gray).

### Gap 3: Task Actions Modal & Server support
Clicking actions other than `run` throws an API error. The client should let users select an agent channel (e.g. claude, codex, pi, openclaw, opencode, antigravity) and optional dependency skipping.
- **Remediation:**
  1. Create a `ChannelModal` component or inline dialog in `TaskDetail.tsx` to prompt for agent channel and a skip-dependencies checkbox on clicking any action.
  2. Add `channel` and `skipDeps` to the `task.action` oRPC input schema in [task.ts](file:///Users/robin/xprojects/spur-new/packages/contracts/src/task.ts).
  3. Wire the Hono handler in `apps/server/src/modules/task/handlers.ts` to spawn `orchestrator run <wbs> [args] --channel <channel>` for all action types (`refine`, `plan`, `run`, `verify`, `decompose`, `evaluate`).
