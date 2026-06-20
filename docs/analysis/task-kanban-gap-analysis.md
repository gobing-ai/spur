# Task Kanban Gap Analysis: Legacy `cc-agents` vs. Modern `spur-new`

**Date:** 2026-06-19  
**Analyst:** Antigravity AI Coding Assistant  
**Scope:** UI/UX and source code review of the legacy task Kanban board in `cc-agents` (running on `http://localhost:3456/`) versus the newly migrated `task` module in `spur-new` (running on `http://localhost:3000/board/tasks?selected=0016`).

---

## Executive Summary

The task Kanban feature has been successfully migrated from the `cc-agents` legacy tasks skill to the current `spur-new` project under the unified `task` module. However, the migration is currently in a **partially implemented state** for the web interface:
1. **Modern Foundation:** The new architecture is highly structured, utilizing Hono, oRPC, and Astro to deliver compile-time type-safety, a cohesive multi-column layout, and unified domain logic in [task-service.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/task-service.ts).
2. **Feature Gaps:** The migrated UI currently acts as a **read-only view**. It lacks critical core features from the legacy `cc-agents` board, including inline Markdown editing, visual drag-and-drop mechanics, interactive metadata panels (progress bars, tags), workflow execution triggers (Refine, Plan, Run, etc.), multi-folder management, and SSE real-time updates.

This document analyzes these gaps across the codebase and user interface, providing a concrete, prioritized remediation roadmap.

---

## 1. Technical Stack & Architecture Comparison

Below is a breakdown of the technological stack and architectural boundaries of both implementations.

| Architectural Layer | Legacy (`cc-agents`) | Modern (`spur-new`) |
| :--- | :--- | :--- |
| **Frontend Framework** | React + Vite (standalone SPA) | Astro + React Island architecture |
| **Styling & Layout** | Custom CSS variables + TailwindCSS | Vanilla CSS grid (`board-layout.css`) + DaisyUI |
| **Drag-and-Drop** | `@hello-pangea/dnd` (Draggable / Droppable) | HTML5 Native Drag & Drop API |
| **Markdown Editing** | `@uiw/react-md-editor` (Interactive) | None (Static read-only text) |
| **Backend Integration** | Raw HTTP requests to custom Hono/Bun Router | oRPC typed client ([rpc-client.ts](file:///Users/robin/xprojects/spur-new/apps/web/src/lib/rpc-client.ts)) |
| **API Boundary** | Hand-rolled regex router with no schemas | Type-safe contract routing via [task.ts](file:///Users/robin/xprojects/spur-new/packages/contracts/src/task.ts) |
| **Real-time Sync** | SSE stream (`/events`) pushing state changes | Polling at a 5-second interval ([useTasks.ts](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/task-kanban/useTasks.ts)) |
| **Concurrency & Locks** | Local custom locking per WBS in [writeLock.ts](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/writeLock.ts) | Unified lock domain in [planning-write-service.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/planning-write-service.ts) |

---

## 2. Feature Gap Matrix

| Feature | Legacy UI | Migrated UI | Gap Severity | Technical / Design Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Column Board View** | Displays 7 status columns. Allows toggling column visibility via header checkboxes. | Displays 7 status columns. **No column visibility toggle** (all 7 always visible). | **Low** | Low styling friction, but can clutter smaller screens. |
| **Drag & Drop** | Fluid drag/drop animations with visual indicators via `@hello-pangea/dnd`. | HTML5 Drag & Drop. Functional but lacks smooth animations and drop-zone feedback. | **Medium** | Drag handles and droppable area transitions need refinement. |
| **Sorting Controls** | Column-specific sort buttons (WBS ascending/descending) with state tracking. | **No sorting controls**; uses default API sorting. | **Medium** | Requires implementing sorting logic in [useTasks.ts](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/task-kanban/useTasks.ts). |
| **Task Cards** | Shows WBS badge, relative time (e.g. `2 hours ago`) auto-updating, full tooltip. | Shows WBS badge, status badge, priority/feature badges. **No timestamp info**. | **Medium** | Missing last updated timestamp indicator on cards. |
| **Task Detail Layout** | Fixed modal backdrop overlay, manually resizable panel with `localStorage` width cache. | Integrated as a static module RightPanel. Collapses/resizes via layouts. | **None** | Replaced by the native 5-column dashboard resizing handle. |
| **Inline Editing** | Full editing of markdown description using `@uiw/react-md-editor` with Save/Cancel. | **Read-only**. Task content/body is completely hidden from the detail pane. | **High** | Critical gap for planning. Users cannot edit task descriptions on the web UI. |
| **Workflow Actions** | Contextual AI buttons: **Refine, Plan, Run, Verify, Decompose, Evaluate**. | **No action buttons**. | **High** | Core automation loop can only be run via CLI commands. |
| **Task Metadata** | Foldable metadata pane with estimated hours, tags, created/updated, and phase progress bars. | Displays static text list for priority, feature, and file. **No progress bars/dates**. | **Medium** | Missing detailed progress indicators. |
| **Task Creation** | "New Task" panel with Name input and Markdown editors for Background/Requirements. | **No creation controls**. Creation is CLI-only. | **High** | Missing form to create task files directly in the active folder. |
| **Multi-Folder Config** | Header dropdown to switch active task folders; config screens to add folders. | Single hardcoded active folder. **No folder selection**. | **Medium** | Under [task-service.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/task-service.ts), `list()` only queries `tasksDir`. |
| **SSE Sync** | SSE updates. Connection dot in header (green/red). | Polling (5s interval). No connection indicator. | **Medium** | Polling is safe but generates more HTTP requests. |
| **Cancel Safety** | Cancel button triggers confirmation modal to prevent accidental closure. | Status button transition immediately cancels task without confirmation. | **Low** | Missing warning alert before marking task cancelled. |

---

## 3. Web UI & UX Comparison

### 3.1 Board Layout & Aesthetic Systems
- **Legacy UI ([App.tsx](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/ui/src/App.tsx)):** Built as a custom standalone application. Uses explicit CSS variables for dark/light themes and custom cards with hover states. Visual feedback (e.g., background color change during drag) makes the board feel dynamic and premium.
- **Modern UI ([index.tsx](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/task-kanban/index.tsx)):** Embedded inside the main Spur board layout. It relies on DaisyUI styling, which matches the dark mode and general aesthetic of Spur nicely. However, the interactive states (hover indicators, drag hover shadows, transition animations) are missing, making it feel less premium than the original.

### 3.2 Task Detail Pane
- **Legacy Pane ([task-detail.tsx](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/ui/src/components/task-detail.tsx)):**
  - Uses `@uiw/react-md-editor` supporting live/preview modes to let users edit, save, and review the markdown file.
  - The foldable metadata panel organizes dates, tags, and progress bars neatly.
  - The AI action controller determines status-based buttons (e.g., only showing **Refine** when the task is in Backlog).
- **Modern Pane ([TaskDetail.tsx](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/task-kanban/TaskDetail.tsx)):**
  - Read-only; lacks markdown rendering entirely.
  - The status buttons are plain buttons that trigger immediate API updates.
  - Missing the entire contextual action logic (cannot trigger orchestrator scripts from the UI).

---

## 4. API & Source Code Comparison

### 4.1 Route Discrepancies
The legacy router in [router.ts](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/router.ts) supports 17 endpoints. By comparison, the new oRPC [taskContract](file:///Users/robin/xprojects/spur-new/packages/contracts/src/task.ts) defines only 4 endpoints:

```typescript
export const taskContract = {
    list: oc.route({ method: 'GET', path: '/tasks' }).output(taskListResponseSchema),
    show: oc.route({ method: 'GET', path: '/tasks/{wbs}' }).input(taskShowInputSchema).output(taskShowResponseSchema),
    create: oc.route({ method: 'POST', path: '/tasks' }).input(taskCreateInputSchema).output(taskCreateResponseSchema),
    transition: oc.route({ method: 'PATCH', path: '/tasks/{wbs}/status' }).input(taskTransitionInputSchema).output(taskTransitionResponseSchema),
};
```

This leaves the following capabilities **completely unmapped** on the oRPC API layer:
1. **Task Action Handlers:** `/tasks/:wbs/actions` (to delegate workflows to the orchestrator).
2. **SSE Events Stream:** `/events` (to push real-time changes to the board).
3. **Artifact Handlers:** `/tasks/:wbs/artifacts` (to read/write attachments).
4. **Dependency Tree:** `/tasks/:wbs/tree` (to generate epic trees).
5. **Validation/Check:** `/tasks/:wbs/check` (to trigger validation checks).
6. **Config Handlers:** `/config` & `/config/template` (to change folders, active paths, and counters).

### 4.2 Write Path and Lock Domain Comparison
- **Legacy:** Relied on [writeLock.ts](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/writeLock.ts) to manage locking per WBS within the HTTP server, while the CLI tool wrote directly to files. This created a potential race condition if CLI commands and server writes overlapped.
- **Modern:** Solves this beautifully by implementing a unified [planning-write-service.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/planning-write-service.ts). Both the CLI commands and the server Hono handlers route mutations through the same [task-service.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/task-service.ts), which wraps all writes in a shared lock domain. This guarantees data integrity.

### 4.3 Task Structure & Transition Validation Mechanics
- **WBS Format & Sorting:** 
  - **Legacy:** Allowed dotted hierarchical WBS strings (e.g. `0001.01`, `0001.01.01`). The sorting utility [taskSort.ts](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/ui/src/utils/taskSort.ts) split WBS by `.` and parsed each chunk as an integer to perform hierarchical depth comparison.
  - **Modern:** Enforces a flat 4-digit WBS schema via Zod (`wbs: z.string().regex(/^\d{4}$/)`). Sub-task relationships are modeled explicitly via the `parent_wbs` frontmatter field (per triage item `X02` in [2026-06-10-rd3-migration-feature-list.md](file:///Users/robin/xprojects/spur-new/docs/plans/2026-06-10-rd3-migration-feature-list.md)).
- **Transition Validation:**
  - **Legacy:** Handled validation client-side inside the drag-and-drop hook [useKanbanDragDrop.ts](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/ui/src/hooks/useKanbanDragDrop.ts) by reading a static [statusTransitions.json](file:///Users/robin/projects/cc-agents/plugins/rd3/skills/tasks/scripts/server/ui/config/statusTransitions.json) file. Since workflow actions (Refine, Plan, Run, etc.) drove transitions, the UI blocked all manual dragging except `Backlog -> Todo`.
  - **Modern:** Validations are driven dynamically server-side via the dual-workflow engine reading the task lifecycle definition `task-lifecycle.yaml`. The client UI ([KanbanBoard.tsx](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/task-kanban/KanbanBoard.tsx)) performs optimistic updates on drag and reverts the board only if the server returns a 409 transition denial.

---

## 5. Remediation Roadmap

To bring the migrated task Kanban board up to legacy parity while preserving Spur's strict architectural guidelines, the following waves are proposed:

### Wave 1: Task Detail & Editing Parity (High Priority)
- **Implement Markdown Rendering/Editing:** Integrate `@uiw/react-md-editor` or a vanilla-friendly markdown editor into `TaskDetail.tsx`.
- **Add Markdown Content API Endpoint:** Add a Zod schema and contract route for updating task bodies (e.g. `PATCH /tasks/{wbs}/body`).
- **Implement Progress & Metadata:** Build progress bars for phase transitions and render tags/dates in `TaskDetail.tsx`.
- **Add "New Task" UI:** Add a "New Task" modal/slide-out panel feeding the existing `create` endpoint.

### Wave 2: Workflow Actions & Verification (Medium Priority)
- **Extend oRPC for Workflows:** Define `task.action` contract endpoint (POST `/tasks/{wbs}/actions`) mapping to the orchestrator runner.
- **Add Action Controls:** Render Refine, Plan, Run, Verify, Decompose, and Evaluate buttons in the detail view based on task status.
- **Status Warnings & Confirmation:** Add a confirmation modal when mark cancelled is selected.

### Wave 3: Real-Time Synchronization & UX Polish (Low Priority)
- **SSE Event Streaming:** Implement the oRPC `stream` endpoint for SSE using standard event schemas mapped from the EventBus.
- **Custom Column Sorting & Visibility:** Build client-side filters for column visibility checkboxes and column-specific WBS sorting toggles.
- **Multi-folder support:** Add folder switching UI feeding from a new config endpoint.
