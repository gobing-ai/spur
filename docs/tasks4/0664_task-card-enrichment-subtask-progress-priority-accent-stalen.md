---
schema_version: 1
name: "Task card enrichment: subtask progress, priority accent, staleness tint"
status: done
template: feature-impl
created_at: 2026-08-25T05:08:07.357Z
updated_at: "2026-08-26T01:49:14.261Z"
feature_id: F72
priority: P2
tags: ["web", "tasks-module", "shell-parity"]
---

## 0664. Task card enrichment: subtask progress, priority accent, staleness tint

### Background
F72 card half: enrich the task card so key facts are visible without opening the detail panel, per
`docs/design/tasks-module-shell-parity.md` §8. All additions derive from fields already on
`TaskSummary`; assignee and transport changes remain out of scope.

Implements feature scenario R7 — Task card surfaces key facts without opening the detail panel.

The verified implementation corrected the original disjoint-surface premise. `TaskCard` cannot see
sibling tasks, and the module fallback store can differ from the folder-scoped store rendered by the
board. `KanbanBoard` therefore owns one folder-scoped store and provides it to cards, drag overlay,
and detail through `TaskStoreContext`; the shell receives only that store's connection boolean. This
keeps progress, lanes, live state, and connection state consistent with one initial list request.

No task-array or progress-map props, contract changes, server changes, dependencies, or new fetches
were introduced.
### Requirements

- [ ] R1. `useTasks` exposes a derived subtask-progress map computed once per store update: for each parent WBS, `{ done, total }` counted from tasks whose `parentWbs` matches, with `done` counting `status === 'done'`. Tasks with an absent `parentWbs` contribute to no group.
- [ ] R2. `TaskCard` reads that map through the existing `useTasks()` store hook — not through new props — and renders a subtask progress chip only when `total > 0`.
- [ ] R3. `TaskCard` renders a priority accent as a colored left border mapped P1 → `spur-error`, P2 → `spur-warning`, P3 → `spur-text-muted`, resolved through the `.task-kanban` token scope. The existing priority badge is kept. An absent or unrecognized `priority` renders no accent.
- [ ] R4. `TaskCard` tints the relative timestamp when `updatedAt` is older than a 7-day threshold declared as a named constant in `TaskCard.tsx`. An absent `updatedAt` renders no tint and no error.
- [ ] R5. No `packages/contracts` or server change; no hex literals; existing card fields (WBS, name, priority badge, type, feature, relative time) and the drag-overlay render path are unchanged.

### Acceptance Criteria

```gherkin
Feature: Task card enrichment — key facts without opening the detail panel

  @core
  Scenario: R1 — Task card surfaces key facts without opening the detail panel
    Given a task that has subtasks, a non-default priority, and an updatedAt older than 7 days
    When the board renders its card
    Then the card shows subtask progress as done/total derived client-side from parentWbs grouping
    And the card shows a priority accent as a colored left border
    And the card shows a staleness tint
    And all of this is visible without opening the task detail panel
```

### Q&A
**Q: Can `TaskCard` group the loaded tasks array itself?**

Closed — no. `TaskCard` receives one task, so `deriveSubtaskProgress` runs when store task state
changes and the card reads its own entry through the existing no-argument `useTasks()` hook.

**Q: How does a card select the same store as a non-default-folder board?**

Closed — `KanbanBoard` provides its folder-scoped store through `TaskStoreContext`; no-argument
consumers use that provider before the module fallback. A regression test proves `1/2` progress and
connection state come from the same non-default-folder store with one list request.

**Q: Does every card subscription add a fetch or require prop drilling?**

Closed — no. All consumers subscribe to the one board-owned external store. The provider carries the
store identity; neither task arrays nor progress maps are threaded through component props.

**Q: Did the implementation need to cross sibling task 0663's original file boundary?**

Closed — yes, after verification exposed the shared-fallback mismatch. The goal-equivalent refinement
touches `KanbanBoard` only to establish store ownership; it does not change the card-enrichment scope.
### Design
**Chosen approach.** Derive card facts from existing `TaskSummary` fields and make the rendered board
the owner of task-store identity.

- **Subtask progress** — `deriveSubtaskProgress` groups children by `parentWbs`, counts
  `status === 'done'`, and is recomputed only when store task state changes. `TaskCard` reads its entry
  through no-argument `useTasks()` and renders it only when `total > 0`.
- **Store ownership** — `KanbanBoard` creates the folder-scoped store, provides it through
  `TaskStoreContext`, and uses the same store for lanes, cards, drag overlay, detail, live connection,
  and refreshes. The module fallback remains for consumers outside a board provider.
- **Shell connection state** — `KanbanBoard` reports only its connection boolean to `TasksShell`; the
  shell does not create a second task subscription.
- **Priority accent** — semantic left-border tokens map P1/P2/P3; absent or unknown priorities have no
  accent and keep the existing badge.
- **Staleness tint** — a named seven-day threshold controls the semantic timestamp tint; absent
  timestamps remain unchanged.

**Why context, not props.** The provider selects an existing store object for several existing
descendants. This avoids task-array/progress-map prop drilling and fixes both observed residuals at
their common cause: divergent store ownership.

**Rejected alternatives.** Server-computed counts and assignee require out-of-scope transport work;
card-local grouping lacks sibling tasks; a second shell store duplicates the initial list request and
can disagree with a non-default folder.

**Invariants.** No contract/server/dependency/hex changes; existing card fields and detail behavior
stay intact; drag overlay uses the same enriched card; progress is hidden at zero children.
### Plan
- [x] Derive `{ done, total }` by `parentWbs` whenever task-store state changes. (R1)
- [x] Return the active store from `useTasks` and resolve a board provider before the module fallback. (R1–R2)
- [x] Provide the folder-scoped store from `KanbanBoard`; report its connection boolean without a second shell subscription. (R1–R2, R5)
- [x] Render conditional progress, semantic priority accents, and seven-day staleness in `TaskCard`. (R2–R4)
- [x] Cover grouping, optional fields, drag/detail regressions, non-default-folder progress, and exactly one initial list request. (R1–R5)
- [x] Run web typecheck, the full web suite, strict task checks, review, and F72 strict verification. (R1–R5)
### Solution
**Current verified change map (2026-08-25).**

| Anchor | Delivered |
| --- | --- |
| `apps/web/src/modules/task-kanban/useTasks.ts:190` | `deriveSubtaskProgress` groups children by `parentWbs`, counts `done`, and runs only when store task state changes (R1). |
| `apps/web/src/modules/task-kanban/useTasks.ts:215` | `useTasks` returns the derived map and resolves a board-provided store before the module fallback (R1–R2). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:55` | `TaskCard` reads progress through the existing no-argument hook and renders the chip only for a non-zero total (R2). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:14` | Semantic P1/P2/P3 priority accents preserve the existing badge and omit unknown/absent accents (R3). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:10` | Named seven-day threshold drives the faint timestamp tint; absent timestamps remain safe (R4). |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx` | Provides its folder-scoped store to lane cards, drag overlay, and detail without task-array or progress-map props. |
| `apps/web/tests/modules/task-kanban/useTasks.test.ts` | Covers grouping, absent-parent exclusion, hook exposure, and recomputation on store updates. |
| `apps/web/tests/modules/task-kanban/components.test.tsx` | Covers the progress chip, all priority mappings, stale/fresh/absent timestamps, and existing card fields. |
| `apps/web/tests/modules/task-kanban/board.test.tsx` | Proves a non-default folder uses one list request and its own `1/2` progress map. |

**Documented design change.** The original disjoint-task plan prohibited touching `KanbanBoard.tsx`; post-verification exposed that a module fallback store could diverge from the board's phase store. The goal-equivalent repair adds `TaskStoreContext` at the board boundary. `TaskCard` still uses `useTasks()` with no new props, grouping remains once per store update, and neither contracts nor server code changed.

The staleness tint uses the dimmer `spur-text-faint` step because the baseline timestamp is already `spur-text-muted`. Existing WBS/name/badge/type/feature/relative-time fields and the drag-overlay card call shape remain unchanged.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Store tests cover grouping, absent-parent exclusion, hook exposure, and recomputation. Repo-root `.spur/run/0664-verdict.json` lines 1-97 regenerated from this fresh verification. |
| R2 | MET | Card uses no-argument `useTasks()`; non-default-folder board test renders `1/2` from that board's store with no map/array props. |
| R3 | MET | Card tests cover P1/P2/P3, absent, and unrecognized priority accents through semantic tokens. |
| R4 | MET | Card tests cover stale, fresh, and absent timestamps against the named seven-day threshold. |
| R5 | MET | No contract/server/hex changes; full web suite covers existing fields, drag overlay, and detail behavior. |
| AC-7 | MET | Feature-scenario alias; the complete scenario evidence is recorded in the acceptance-criteria table below. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Task card surfaces key facts without opening the detail panel | MET | test | Board/store/card tests cover folder-correct `1/2` progress, semantic priority accents, and seven-day staleness without opening detail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional, SECUA, and architecture review PASS. The former phase-store divergence is closed. |

**Functional traceability.**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/task-kanban/useTasks.ts:190` plus store tests cover grouping, done counts, absent parents, and per-update recomputation. |
| R2 | MET | `apps/web/src/modules/task-kanban/TaskCard.tsx:55` and board integration prove the no-prop hook reads the active phase store and renders `1/2`. |
| R3 | MET | Priority tests cover P1/P2/P3, absent, and unrecognized values through semantic tokens. |
| R4 | MET | Timestamp tests cover stale, fresh, and absent values against the named seven-day threshold. |
| R5 | MET | No contract/server/hex changes; full web tests cover existing fields, drag overlay, and detail behavior. |

**SECUA.** No security or trust-boundary change. The active-folder progress map and exact-one-list-request regression tests cover correctness and efficiency. Optional priority/timestamp fields remain guarded.

**Architecture.** The derived map remains local to `TaskStore`; context selects the already-owned board store for lane cards, overlay cards, and detail. No tasks array or map is threaded through component props. The one provider serves multiple consumers, so it is a concrete ownership seam rather than speculative indirection. No deepening candidates remain in the F72 scope.

**Residual risk:** none identified within F72 scope.
### References

- Parent feature: `docs/features/F72_tasks-module-history-shell-parity-unified-header-inline-filters-full-bleed-density.md`
- Decision: `docs/00_ADR.md` ADR-081 — Board Module Shell Convention
- Shapes SSOT: `docs/design/tasks-module-shell-parity.md` §8 (card contents)
- UI design SSOT: root `DESIGN.md` (tokens, density)
- Contract: `packages/contracts/src/task.ts:14,16,23` (`TaskSummary.priority` / `parentWbs` / `updatedAt`, all optional)
- Sibling: task 0663 (shell — feature R1–R6, R8–R12)

### History

- 2026-08-25T06:15:04.405Z todo → wip (system)
- 2026-08-25T06:24:44.505Z wip → testing (system)
- 2026-08-25T06:24:48.324Z testing → done (system)
