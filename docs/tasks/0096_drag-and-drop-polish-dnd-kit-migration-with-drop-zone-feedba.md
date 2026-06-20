---
schema_version: 1
name: "Drag-and-drop polish: dnd-kit migration with drop-zone feedback and animations"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.369Z
updated_at: 2026-06-20T15:57:14.415Z
feature_id: F7
priority: P2
tags: ["task-kanban", "wave-2", "web", "dnd", "ux"]
---

## 0096. Drag-and-drop polish: dnd-kit migration with drop-zone feedback and animations

### Background

Implements gap-analysis §2 (Drag & Drop — Medium) + §3.1 + Wave 2. Effort: ~8h. The migrated board uses HTML5 native drag-and-drop: functional but without the smooth animations, drag handles, and drop-zone feedback the legacy @hello-pangea/dnd board had, making it feel less premium. This task migrates the board DnD to dnd-kit (restored in 0089), adding drop-zone highlighting, drag overlays, and transition animations, while preserving the existing optimistic-update-then-revert-on-409 transition semantics (the server lifecycle engine remains the validation authority). Depends on 0089 (dnd-kit dep). Ordering: after 0089; independent of the editor/action work.

### Requirements
- [ ] R1. Replace the board's HTML5 native DnD with dnd-kit (DndContext/sortable) in KanbanBoard.tsx, preserving column-to-column moves.
- [ ] R2. Add visual feedback: drop-zone highlight on the target column, a drag overlay/handle for the card being moved, and smooth move/settle animations.
- [ ] R3. Preserve the existing transition semantics — optimistic move on drop, revert the card to its source column if the server returns a 409 transition denial; the server lifecycle engine stays the sole validation authority (no client-side transition rules reintroduced).
- [ ] R4. Keyboard/accessibility: dnd-kit's keyboard sensor is enabled so cards are movable without a mouse (a legacy-parity-plus improvement).
- [ ] R5. Tests: a drop invokes the transition API and optimistically moves the card; a denied transition reverts it. Manual browser check of drag feel/feedback recorded in Testing. Gate green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — the board uses dnd-kit for column-to-column moves
  Given the kanban board
  When I drag a card from one column to another
  Then the move is handled by dnd-kit (DndContext/sortable), not HTML5 native DnD

Scenario: R2 — visual feedback during drag
  Given a drag in progress
  When the card is over a target column
  Then the drop zone is highlighted, a drag overlay/handle is shown, and the settle animates smoothly

Scenario: R3 — optimistic transition with revert is preserved
  Given a card dropped in a new column
  When the drop completes
  Then the card moves optimistically and api.task.transition is called
  And a 409 transition denial reverts the card to its source column
  And the server lifecycle engine remains the only validation authority (no client-side transition rules)

Scenario: R4 — cards are movable by keyboard
  Given keyboard focus on a card
  When I use the dnd-kit keyboard sensor
  Then the card can be moved between columns without a mouse
```

Edge cases (advisory):

```gherkin
Scenario: R5 — dropping a card back into its own column is a no-op
  Given a card dragged within its current column
  When dropped without changing status
  Then no transition request is made and no visual flicker occurs
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — replace the HTML5 native DnD in KanbanBoard with dnd-kit (DndContext + droppable columns), preserving the existing optimistic-transition-then-revert semantics exactly.**

The board today (`KanbanBoard.tsx`) uses HTML5 `onDrop` and already does the right transition flow: optimistic `setTasks((prev) => map status)` → `api.task.transition({ wbs, toStatus })` → on error `setTasks(previous)` (revert). The gap is purely interaction polish — no animation, drop-zone feedback, or keyboard support.

**dnd-kit structure.** Wrap the board in `<DndContext>`; each `KanbanColumn` becomes a droppable, each `TaskCard` a draggable. `onDragEnd` computes the target column's status and runs the **same** optimistic+revert logic that exists today — the transition mechanism is unchanged, only the drag mechanics swap.

**Visual feedback (R2).** Use dnd-kit's `DragOverlay` for the floating card, droppable `isOver` state to highlight the target column, and CSS transitions for the settle. This is the "premium feel" the gap analysis calls out as missing.

**Preserve the server-authority invariant (R3).** No client-side transition-legality rules are reintroduced — the board stays optimistic and lets the server (lifecycle engine) reject with 409, reverting on failure. This is critical: the legacy board hard-coded `statusTransitions.json` client-side; the modern design deliberately moved that authority server-side (gap-analysis §4.3). 0096 must not regress that.

**Keyboard (R4).** Enable dnd-kit's `KeyboardSensor` so cards move without a mouse — a parity-plus accessibility win.

**No-op guard (R5).** A drop that doesn't change column issues no transition (avoid a pointless request + flicker).

**Depends on:** 0089 (dnd-kit dep). **Invariant:** optimistic-update-then-revert and server-side transition authority are unchanged; this task only upgrades the drag interaction layer.
### Plan
1. Wrap KanbanBoard in `<DndContext>`; make `KanbanColumn` a droppable and `TaskCard` a draggable (dnd-kit, restored in 0089). Remove the HTML5 `onDrop`/`draggable` wiring.
2. In `onDragEnd`, derive the target column's status and reuse the existing optimistic `setTasks` + `api.task.transition` + revert-on-error flow verbatim — do not change the transition mechanism.
3. Add `DragOverlay`, droppable `isOver` highlight, and settle animations for visual feedback.
4. Enable the `KeyboardSensor` so cards move via keyboard.
5. Add the no-op guard: a same-column drop issues no transition.
6. Tests: a drop invokes `transition` and moves the card optimistically; a denied (409) transition reverts; a same-column drop is a no-op. Record a manual browser feel/feedback check in Testing. Run the gate.
### History
