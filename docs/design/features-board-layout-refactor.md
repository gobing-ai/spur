# Features Board Layout Refactor & UI Enhancement — Design

**Feature:** F84 · **Date:** 2026-08-23 · **Status:** Draft / System Design

## 1. Context & Motivation

The `Features` board module (`apps/web/src/modules/features/`) is functionally robust, supporting live SSE updates, hierarchical feature trees, status transitions, and MDEditor body editing. However, its layout retains a rigid two-column split (`w-72` fixed tree + full-width detail) that diverges from the modern Linear dark-canvas design system (`DESIGN.md`) and the layout conventions established in the `History` module (`HistoryShell.tsx`).

This design specifies:
1. Alignment with `History` module shell layout (centered `max-w-[1600px]`, standard header with icon, title, description, and module action container).
2. A collapsible, floating/dockable left sidebar for the Feature Tree hierarchy.
3. Reading-optimized width constraints on the Markdown preview and edit canvases.
4. A collapsible right-side drawer for feature metadata (folded by default).
5. A refined visual hierarchy for the stage-based dynamic action buttons.
6. A foldable floating glassmorphism prompt/agent bar at the bottom of the viewport (UI-only stub).

---

## 2. Component Hierarchy & Layout Anatomy

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ FeaturesShell (max-w-[1600px] mx-auto w-full p-4 flex flex-col gap-4)                  │
│                                                                                        │
│ ┌─ Module Header ────────────────────────────────────────────────────────────────────┐ │
│ │ [ 🎯 Features ]   Hierarchical feature roadmap & AC      [ + New ] [ Filter ▾ ]   │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌─ Main Work Area (relative flex-1 flex overflow-hidden min-h-[700px]) ───────────────┐ │
│ │                                                                                    │ │
│ │  ┌─ [Left Dock] ─┐   ┌─ Central Feature Detail View (max-w-4xl mx-auto) ────────┐  │ │
│ │  │ [Toggle Icon] │   │                                                          │  │ │
│ │  │ ───────────── │   │  ┌─ Detail Header & Refined Dynamic Action Bar ───────┐  │  │ │
│ │  │ Feature Tree  │   │  │ [◍ F84] Title ...       [ Start ] [ + Task ▾ ] [⚙] │  │  │ │
│ │  │ Hierarchy     │   │  └────────────────────────────────────────────────────┘  │  │ │
│ │  │ (Slide-over/  │   │                                                          │  │ │
│ │  │  Floating)    │   │  ┌─ Markdown Canvas (Preview / MDEditor) ─────────────┐  │  │ │
│ │  │               │   │  │ Width-constrained, typography-optimized body       │  │  │ │
│ │  │               │   │  └────────────────────────────────────────────────────┘  │  │ │
│ │  └───────────────┘   └──────────────────────────────────────────────────────────┘  │ │
│ │                                                                                    │ │
│ │  ┌─ [Right Metadata Drawer] ─────────────────────────────────────────────────────┐ │ │
│ │  │ [Folded by default, expands on trigger icon click]                            │ │ │
│ │  │ Frontmatter, Timestamps, Linked Tasks, Child Features, File Path              │ │ │
│ │  └───────────────────────────────────────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌─ Floating Agent Bar (Bottom 75% width centered / Foldable to spirit icon) ─────────┐ │
│ │ [ 💬 Ask coding agent to refine or implement...                   ] [ ✈ Send ]     │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specifications

### 3.1 Module Header & Action Container
- **Location:** Top of `FeaturesShell`.
- **Left:** Module emoji `🎯`, Title `Features`, Subtitle `Hierarchical feature roadmap, acceptance criteria, and lifecycle progression`.
- **Right:** Module action container:
  - `+` / `New Root Feature` button.
  - Status filter dropdown menu (All, Backlog, Active, Verifying, Done, Cancelled, Blocked).
  - Refresh / Sync button.

### 3.2 Floating & Collapsible Feature Tree Panel
- **Behavior:** Docked on the left side of the workspace.
- **States:**
  - Expanded: Width `w-72` (or `w-80`), displaying the nested feature tree with status icons and search/filter affordance.
  - Collapsed: Collapses to a compact floating vertical dock / tab with a toggle icon (e.g. sidebar collapse icon `◀ / ▶` or `🗂️`), giving full canvas width to the detail view.
- **Positioning:** Floating panel with subtle shadow (`shadow-lg`), hairline border (`border-spur-border`), and smooth CSS transition (`transition-all duration-200`).

### 3.3 Constrained Markdown Reading Canvas
- **Width:** `max-w-4xl mx-auto w-full` for both Markdown preview (`MarkdownBody`) and editor (`MDEditor`).
- **Typography:** Conforms to `DESIGN.md` linear text tokens, preventing illegible long lines on ultra-wide monitors.

### 3.4 Collapsible Right-Side Metadata Drawer
- **Default State:** Folded / hidden.
- **Trigger:** Docked icon button (`⚙` / `ℹ` / `📋 Metadata`) in the feature detail header or right edge.
- **Content:**
  - Status badge & frontmatter attributes.
  - File path (`font-mono text-xs`).
  - Child features list with direct navigation links.
  - Linked tasks list with status badges and navigation to Kanban board.
  - Timestamps (`created_at`, `updated_at`).

### 3.5 Refined Stage-Based Dynamic Action Bar
- Re-architects `FEATURE_STATUS_ACTIONS` into a 3-tier visual hierarchy:
  1. **Primary Stage Action (Prominent CTA):** e.g., `Start` (for `backlog`), `Verify` (for `active`), `Complete` (for `verifying`), `Unblock` (for `blocked`). Uses `Button variant="primary"` with accent background.
  2. **Secondary Management Actions (Ghost / Outline Buttons):** `+ Child`, `+ Task`, `Link Task`, `Sync`.
  3. **Hazards & Transitions (Discrete / Overflow):** `Block`, `Rework`, `Cancel`. Uses subtle ghost/error styling with modal confirmations.

### 3.6 Floating Agent Prompt Bar (UI Stub)
- **Position:** Fixed floating bar at the bottom center of the viewport.
- **Expanded State:**
  - Occupies ~75% of viewport width (`max-w-4xl`), centered horizontally.
  - Glassmorphic styling: `backdrop-blur-md bg-base-100/80 border border-base-content/10 shadow-2xl rounded-2xl p-2.5`.
  - Controls: Textarea for agent prompts, target model/agent badge, submit button (`Send`), and a collapse toggle button.
- **Collapsed State:**
  - Collapses into a floating circular/rounded spirit icon button docked in the bottom-right corner (`fixed bottom-6 right-6`).
  - Clicking the spirit icon smoothly expands the prompt bar.
- **Backend Coupling:** Purely frontend UI; no agent subprocess or backend API invocations at this stage.

---

## 4. Conformance to DESIGN.md

| Element | Token / Value |
|---------|---------------|
| Canvas | `#010102` / `bg-base-100` |
| Panels & Cards | `#0f1011` / `#141516` (`bg-base-200`) |
| Borders | `#23252a` (`border-base-content/10` / `border-spur-border`) |
| Primary Accent | `#5e6ad2` (`bg-primary` / `text-primary-content`) |
| Text Primary | `#f7f8f8` (`text-spur-text`) |
| Text Muted | `#8a8f98` (`text-spur-text-muted`) |
| Typography | Display / Linear Text font stack |
