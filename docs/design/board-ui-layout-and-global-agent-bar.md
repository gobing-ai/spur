# Spur Board UI Layout Optimization & Global Orchestrator Agent Interface — Design

**Feature:** A7 · **Date:** 2026-09-06 · **Status:** Draft

## 1. Context & Motivation

Spur Board (`apps/web`) is the local-first visual operations interface for autonomous coding agent orchestration, history forensics, feature planning, and task execution.

As the board has evolved across multiple modules (Features, History, Observability, Tasks, Workspace, Inbox, Teams), several UX friction points have emerged:
1. **Left Sidebar Usability**:
   - The sidebar defaults to open, consuming horizontal screen real estate on standard laptop screens.
   - The theme switcher is positioned in the expanded top header; when the sidebar is collapsed to icon rail mode, there is no theme toggle or settings access.
   - Module labels are inconsistently singular/plural (`Observability` vs `Features`, `History` vs `Tasks`).
   - Module discovery order lacks a deliberate flow from telemetry to tasks to agent teams.
   - Collapsed rail tooltips are bare HTML title attributes without contextual hints.
2. **Global LLM Orchestrator Surface**:
   - The `FloatingAgentBar` component was built inside the `Features` module (`modules/features/FloatingAgentBar.tsx`).
   - In reality, the agent orchestrator is a project-wide coordinator that inspects and interacts across all modules (e.g., querying task status from Observabilities, running tasks from Tasks, synthesizing history in Histories).
   - Confining the prompt interface to Features fragments the mental model and forces unnecessary navigation.

This design establishes a clean, responsive layout foundation with a default-folded left rail, dedicated utility footer, normalized module architecture, and an omnipresent global orchestrator agent interaction panel.

---

## 2. Component Hierarchy & Layout Anatomy

```text
┌─ BoardApp ────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ BoardLayout ─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ┌─ LeftSidebar (Folded by default, w-[56px] rail; expandable to w-[240px]) ────────────────┐  │ │
│ │ │  [Header: Fold Button, ProjectSwitcher (expanded), Mobile Close]                         │  │ │
│ │ │  [Nav: Observabilities, Histories, Features, Tasks, Workspace, Inbox, Teams]             │  │ │
│ │ │  [Footer (border-t): ThemeToggle, SettingsButton (vertical rail when folded)]             │  │ │
│ │ └──────────────────────────────────────────────────────────────────────────────────────────┘  │ │
│ │ ┌─ MainWorkspace (flex-1 overflow-hidden) ──────────────────────────────────────────────────┐  │ │
│ │ │  [Module Content via <Outlet />: Active Module Shell]                                      │  │ │
│ │ └──────────────────────────────────────────────────────────────────────────────────────────┘  │ │
│ │ ┌─ RightPanel (Collapsible detail / inspector drawer) ──────────────────────────────────────┐  │ │
│ │ │  [Active module right-panel contribution or task detail]                                   │  │ │
│ │ └──────────────────────────────────────────────────────────────────────────────────────────┘  │ │
│ │ ┌─ GlobalAgentBar (Omnipresent floating orchestrator interface) ────────────────────────────┐  │ │
│ │ │  • Folded: ✨ Spirit Dock icon at bottom-6 right-6 with status indicator                   │  │ │
│ │ │  • Expanded: Centered glassmorphic bar (max-w-[84rem]) with:                               │  │ │
│ │ │    - Active module context pill ("Context: Observabilities")                              │  │ │
│ │ │    - Agent orchestrator badge ("orchestrator · agent")                                    │  │ │
│ │ │    - Textarea prompt input + action chips + send trigger                                  │  │ │
│ │ │    - Expandable execution drawer slot for streaming telemetry and agent tool calls        │  │ │
│ │ └──────────────────────────────────────────────────────────────────────────────────────────┘  │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Left Sidebar Architecture

### 3.1 Default Folded Mode
- In `apps/web/src/lib/layout-state.ts`:
  ```ts
  const DEFAULTS: LayoutState = {
      sidebarWidth: 240,
      rightPanelWidth: 320,
      sidebarCollapsed: true, // Default to folded icon rail
      rightPanelCollapsed: true,
  };
  ```
- Existing users with saved localStorage state retain their explicit preference; fresh sessions or resets initialize in folded mode.

### 3.2 Dedicated Sidebar Footer
- A dedicated footer container (`border-t border-spur-border bg-spur-surface shrink-0`) is anchored at the bottom of the sidebar.
- **Expanded state (`w-[240px]`)**:
  - Horizontal flex layout with comfortable padding (`p-2.5 flex items-center justify-between gap-2`).
  - Contains:
    1. Theme switcher button (`ThemeToggle`) with label/tooltip.
    2. Settings icon button (`SettingsButton`) triggering the global settings modal.
- **Collapsed rail state (`w-[56px]`)**:
  - Vertical flex layout (`py-2 flex flex-col items-center gap-2`).
  - Contains:
    1. Theme switcher icon button.
    2. Settings icon button.

### 3.3 Module Registry Order & Renaming
- To provide a logical operational hierarchy, modules are ordered from runtime telemetry to core workflows to collaboration:
  1. `observability` (`order: 10`) — Renamed to **`Observabilities`** (`sidebarLabel: 'Observabilities'`).
  2. `history` (`order: 20`) — Renamed to **`Histories`** (`sidebarLabel: 'Histories'`).
  3. `features` (`order: 30`) — **`Features`**.
  4. `task-kanban` (`order: 40`) — **`Tasks`**.
  5. `workspace` (`order: 50`) — **`Workspace`**.
  6. `inbox` (`order: 60`) — **`Inbox`**.
  7. `teams` (`order: 70`) — **`Teams`**.
- In `apps/web/src/modules/discover.ts`:
  - `compareModules` maintains this ascending numerical sort deterministically.

### 3.4 Enhanced Tooltips
- When the sidebar is folded, navigation links display enhanced tooltip overlays:
  - Header: Module title (e.g., `Observabilities`).
  - Body: Capability description (e.g., `Real-time system events, execution traces, and agent doctor telemetry`).
  - Positioning: Left-aligned popover anchored right of the rail (`tooltip-right` with `z-50`).

---

## 4. Global Orchestrator Agent Panel (`GlobalAgentBar`)

### 4.1 Component Migration
- Extract `FloatingAgentBar` out of `modules/features/` and move into global components:
  - Source: `apps/web/src/components/GlobalAgentBar.tsx`.
  - Mount point: Rendered directly inside `BoardLayout.tsx` alongside `MainWorkspace` and `RightPanel`.
  - Remove redundant instance from `FeaturesShell.tsx`.

### 4.2 Reserved Orchestrator Capabilities
The component acts as the visual frontend interface for the project orchestrator coding agent:
1. **Module Context Awareness**:
   - Consumes `ActiveModuleContext` from `BoardLayout`.
   - Injects the active module tag into prompts and displays a visible pill (e.g. `[Context: Observabilities]`).
2. **Status Docking**:
   - Collapsed: Circular spirit dock (`bottom-6 right-6`) with pulsing halo when agent activity is in progress.
   - Keyboard trigger: Accessible via `⌘K` or click.
3. **Execution & Drawer Slots**:
   - Expandable drawer toggle allowing the user to view recent thoughts, tool call executions, and plan progress.
   - Honest status notice for un-wired backend endpoints with graceful stub messaging.
4. **Contextual Quick-Action Chips**:
   - Dynamic prompt chips depending on the active module:
     - Features: "Decompose feature", "Verify acceptance criteria"
     - Tasks: "Run task", "Check readiness", "Refine requirements"
     - Observabilities: "Explain recent failure", "Audit doctor status"
     - Histories: "Summarize session", "Find recurring bottlenecks"

---

## 5. Open Design Verification Seam

- Layout prototypes, token consistency, and visual hierarchy can be verified against Open Design workspaces:
  - Dark canvas tokens (`#0f1117` base, `#161922` surface, `#252936` border).
  - Accent colors: Spur violet/cyan gradients.
  - Consistent padding scales (4px grid) and typographic contrast.
