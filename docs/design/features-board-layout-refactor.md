# Features Board Layout Refactor & UI Enhancement — Design

**Feature:** F84 / F841 · **Date:** 2026-08-24 · **Status:** Implemented (F841 Refinement)

## 1. Context & Motivation

The `Features` board module (`apps/web/src/modules/features/`) provides interactive feature hierarchy inspection, status transitions, planning event tailing, and Markdown editing.

Feature **F841** refines the layout and interactions:

1. **Floating Feature Tree / Metadata overlay**: The Feature Tree is a floating overlay docked at the LEFT of the main body panel in the work area below the module header — a separate panel outside the body that consumes no layout width, so the body keeps the full header width (enough room for feature details). The Metadata panel remains an absolute right overlay inside the detail workspace.
2. **Header-integrated editing**: Removed the in-body `BODY` row; `Edit` is positioned in the detail header immediately before `Metadata`; while editing, that slot substitutes `Save` followed by `Cancel`.
3. **Full-width reading & editing**: Markdown preview and editor canvases span the full width of the detail container (`w-full`), aligned directly with the header boundaries without arbitrary `max-w-4xl` caps.
4. **Wider, folded-by-default prompt bar**: `FloatingAgentBar` initializes folded to a compact spirit icon dock (`bottom-6 right-6`). When expanded, it centers with `w-[calc(100vw-2rem)] max-w-[84rem]`, preserving 1rem viewport gutters without horizontal overflow.
5. **Recursive branch folding**: Parent nodes in `FeatureTree` feature dedicated accessible fold buttons (`Collapse|Expand <id>: <name>`) with `aria-expanded` and `aria-controls`. Branches start expanded; collapsing a branch removes its recursive descendants from the DOM while preserving nested and unrelated fold states.
6. **Draft-safe refresh**: SSE background reloads during active edit mode update server metadata while protecting in-progress editor drafts from clobbering.

---

## 2. Component Hierarchy & Layout Anatomy

```
│  ┌─ Central Container (w-full max-w-[1600px] mx-auto flex-col) ──────────────────────────────────────┐ │
│  │                                                                                                    │ │
│  │  ┌─ Module Header (w-full) ──────────────────────────────────────────────────────────────────────┐ │ │
│  │  │  [ 🎯 Features ]   Hierarchical roadmap                    [ ◧ Tree ] [ Filter ▾ ] [ + ]      │ │ │
│  │  └───────────────────────────────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                                                    │ │
│  │  ┌─ Body Area (relative, below header; body is w-full = header width) ──────────────────────────┐ │ │
│  │  │  ┌─ [Floating Feature Tree overlay] ┐                                                       │ │ │
│  │  │  │  [🌳 Feature Tree]               │  ┌─ Main Detail Workspace (w-full rounded-lg border) ┐ │ │ │
│  │  │  │  [▶] F  Root                     │  │  ┌─ Detail Header ────────────────────────────────┐ │ │ │ │
│  │  │  │    [▼] F1 Child                  │  │  │  [◍ F84] Title ...    [Verify] [Edit] [ℹMeta] │ │ │ │ │
│  │  │  │      F1A Grandchild              │  │  │  └─────────────────────────────────────────────┘ │ │ │ │
│  │  │  │  (absolute right-[calc(100%_+     │  │  │                                                 │ │ │ │
│  │  │  │   12px)] top-0 bottom-0 z-20      │  │  │  ┌─ Full-Width Markdown Canvas ──────────────┐ │ │ │ │
│  │  │  │   w-72 / lg:w-80; right edge      │  │  │  │  Preview / MDEditor spanning container    │ │ │ │ │
│  │  │  │   clear of the body, no overlap)  │  │  │  └─────────────────────────────────────────────┘ │ │ │ │
│  │  │  └──────────────────────────────────┘  │  └──────────────────────────────────────────────────┘ │ │ │
│  │  └─────────────────────────────────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                                                    │ │
│  └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                        │
│ ┌─ Floating Agent Bar (Folded by default to ✨ spirit dock at bottom-6 right-6) ────────┐               │
│ │ [Expanded: w-[calc(100vw-2rem)] max-w-[84rem] glassmorphic prompt bar]              │               │
│ └────────────────────────────────────────────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specifications

### 3.1 Central Container & Module Header

- **Container:** Dedicated central column (`flex flex-col h-full flex-1 max-w-[1600px] min-w-0 gap-3`) ensuring identical width constraint and horizontal alignment across both Module Header and Main Body, matching the standard `History` layout contract.
- **Location:** Top of Central Container.
- **Left:** Module emoji `🎯`, Title `Features`, Subtitle `Hierarchical feature roadmap, acceptance criteria, and lifecycle progression`.
- **Right:** Module action cluster:
  - Tree dock toggle button (`◧` / `▶`) with `aria-controls="feature-tree-dock"` and `aria-expanded`.
  - Status filter dropdown menu (All, Backlog, Active, Verifying, Done, Cancelled, Blocked).
  - Add root feature button (`+`).

### 3.2 Floating Feature Tree with Branch Folding

- **Floating behavior:** Floating overlay: an absolute panel (`absolute right-[calc(100%_+_12px)] top-0 bottom-0 z-20 w-72 lg:w-80 flex flex-col overflow-hidden rounded-lg border border-spur-border bg-base-200 shadow-xl`), rendered inside the body-area wrapper and anchored to the left margin — its right edge sits 12px left of the detail workspace's left edge, so the two never overlap. A separate panel outside the body that consumes no layout width, so the body keeps the full container width (matching the header). `top-0 bottom-0` aligns it to the body panel's top/bottom (below the module header), so it never intersects the header. Toggling via the module header button flips the native `hidden={!isTreeOpen}` attribute and never resizes the body. It includes a dedicated panel header with title (`🌳 Feature Tree`) and is unclosable from the panel itself.
- **Branch folding:**
  - `FeatureTree` manages root `collapsedIds: Set<string>` state (empty default = all expanded).
  - Parent nodes render a dedicated fold button before the row button (`aria-label="Collapse|Expand <id>: <name>"`, `aria-expanded`, `aria-controls="feature-tree-children-<id>"`).
  - Leaf nodes render a layout spacer with no fold control.
  - Collapsing a parent omits its child `<ul>` from DOM and tab navigation. Reopening restores nested branch fold states.

### 3.3 Detail Header Action Cluster & Full-Width Canvas

- **Header Actions Order:** Dynamic FSM primary/secondary actions → hazard actions → `Edit` (or `Save` then `Cancel` during edit mode) → `ℹ Metadata` toggle → close button (`✕`).
- **Body Canvas:** Eliminates in-body `BODY` row and `max-w-4xl` limits. Both `MarkdownBody` and `MDEditor` expand across `w-full` of the detail workspace.
- **Draft Precedence:** `refreshKey` SSE reloads during active editing preserve `draftBody` buffers, updating frontmatter/status while preventing draft replacement.

### 3.4 Right Metadata Inspector Overlay

- **Overlay behavior:** In-pane absolute right inspector (`absolute inset-y-0 right-0 z-30`) (`w-80 max-w-full flex flex-col overflow-hidden border-l border-spur-border bg-base-200 shadow-xl`), folded by default (`aria-hidden="true"`). Includes top-right close icon (`✕`) for easy dismissal.
- **Controls:** Opened via header `ℹ Metadata` toggle; dismissible on `✕` close button or `Escape` (unless a nested modal is open).

### 3.5 Floating Agent Prompt Bar

- **Default State:** Folded into a floating circular spirit dock (`fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full`).
- **Expanded State:** Centers horizontally at `fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] max-w-[84rem]`.
- **Behavior:** Pure frontend UI stub; clears prompt on send and surfaces an honest informational notice.

---

## 4. Conformance to DESIGN.md

| Element | Token / Class |
| --------- | --------------- |
| Canvas Background | `#010102` / `bg-base-100` |
| Overlays & Panels | `#0f1011` / `#141516` (`bg-base-200`) |
| Borders | `#23252a` (`border-spur-border`) |
| Primary Accent | `#5e6ad2` (`bg-primary` / `bg-spur-accent`) |
| Text Primary | `#f7f8f8` (`text-spur-text`) |
| Text Muted | `#8a8f98` (`text-spur-text-muted`) |
| Typography | Standard Linear Text / JetBrains Mono font stack |
