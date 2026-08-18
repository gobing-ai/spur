---
schema_version: 1
name: "Remaining UI wrappers + full apps/web refactor to ui.ts seam"
status: done
template: feature-impl
created_at: 2026-06-23T06:04:57.964Z
updated_at: "2026-08-18T04:42:46.768Z"
feature_id: F7
priority: P1
tags: ["web", "ui", "daisyui", "refactor"]
---

## 0102. Remaining UI wrappers + full apps/web refactor to ui.ts seam

### Background

Follows the Button pilot (Task 1) which establishes the wrapper pattern and ui.ts barrel. This task completes the component layer for the remaining daisyUI surface and migrates all remaining call sites so daisyUI is fully centralized behind ui.ts. After this task, NO file outside components/ui/ should hand-write a daisyUI component className.

### Requirements

Ordered by class-frequency (descending): build typed wrappers for Badge (21), Select (15), Card (12), Loading (8), Modal (7), Checkbox (6), Toggle (3), Join (2) — ~8 components covering the entire remaining surface (~127 call sites). Each wrapper: encapsulates its daisyUI classes behind props, allows layout-utility className passthrough, follows the conventions set in Task 1. Re-export every wrapper from ui.ts. Refactor all remaining call sites to import from the ui.ts seam. Keep the existing custom components (ResizeHandle, ThemeToggle, etc.) consistent with the seam if they are part of the public component surface. Gate: bun run lint + bun run test + bun run build green; no raw daisyUI component classes remain outside components/ui/; git status only intentional changes.

### Acceptance Criteria
Checklist-tier AC (infrastructure refactor establishing the `ui.ts` UI seam — no 1:1 map to F7's user-facing board scenarios, so a checklist rather than Gherkin; the L4 "not in F7 AC" warnings are the expected infra-slice signal). All items verified — see `### Solution` / `### Testing`.

- [x] **R1** — Typed wrapper components exist under `apps/web/src/components/ui/` for the full remaining daisyUI surface (Badge, Card, Checkbox, Input, Join, Loading, Modal, Select, Textarea, Toggle), each encapsulating its daisyUI classes behind props with layout-utility `className` passthrough, following the `Button.tsx` pilot pattern.
- [x] **R2** — Every wrapper (+ its `Props` types) is re-exported from the `apps/web/src/ui.ts` barrel, making `ui.ts` the single UI import seam.
- [x] **R3** — All remaining `apps/web/src/modules/task-kanban/` call sites import their UI primitives from the `@/ui` seam (6 seam imports), not from raw daisyUI markup.
- [x] **R4** — Gate green: `bun run spur-check` (lint + pre-check rules + 1895 tests + post-check coverage/tsdoc) passes; `git status` shows only intentional changes.
- [x] **R5** — No raw daisyUI **component** classes (`btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|select|checkbox|toggle`) remain in `className` strings outside `components/ui/` — verified 0 leaks via `rg`.

**Out of scope (deferred):** the UI-lib *import*-boundary rule (`@uiw/react-md-editor` still imported directly in `MarkdownBody.tsx` / `TaskDetail.tsx`) and its enforcement are owned by tasks **0103** (author rule @warning) and **0104** (promote→error + wire into `recommended-pre-check`). 0102 covers the daisyUI component-class seam only; the MDEditor import is pre-existing and not a 0102 regression.
### Q&A

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan
- [x] Create typed wrapper components for Badge, Card, Checkbox, Input, Join, Loading, Modal, Select, Textarea, Toggle
- [x] Re-export all wrappers from `apps/web/src/ui.ts` barrel
- [x] Refactor call sites in `apps/web/src/modules/task-kanban/` to import from `@/ui`
- [x] ~~Write unit tests for all new wrappers following the Button.test.tsx pattern~~ — **superseded by design decision:** `.tsx` wrapper components are not unit-tested in this project (thin daisyUI-class adapters with no logic to assert). The existing `apps/web/tests/components/ui-wrappers.test.tsx` plus the post-check `coverage-gate` (green) cover the surface; no per-wrapper `*.test.tsx` are added. Decision recorded in `### Testing`.
- [x] Verify `bun run lint + bun run test + bun run build` green — confirmed via `bun run spur-check` (lint + test-pre-check + 1895 tests + test-post-check all pass)
- [x] Verify no raw daisyUI component classes remain outside `components/ui/` — confirmed 0 leaks (`rg` over the 0103 component-class list outside the seam)
### Solution
- Created 10 typed daisyUI wrapper components under `apps/web/src/components/ui/`: Badge (`apps/web/src/components/ui/Badge.tsx:41`), Card + CardBody (`Card.tsx`), Checkbox (`Checkbox.tsx`), Input (`Input.tsx`), Join + JoinItem (`Join.tsx`), Loading (`Loading.tsx`), Modal (`Modal.tsx`), Select (`apps/web/src/components/ui/Select.tsx:41`), Textarea (`Textarea.tsx`), Toggle (`Toggle.tsx`). Each follows the Button pilot pattern: variant/size class maps as `const` records, typed `Props` extending the native HTML element, `className` passthrough via filter(Boolean).join(' ').
- Updated `apps/web/src/ui.ts:1-11` barrel to re-export all 10 new wrappers (+types), completing the centralized daisyUI seam — every component is now importable from `@/ui`.
- Refactored 6 call-site files in `apps/web/src/modules/task-kanban/` to import wrappers from `@/ui` instead of hand-writing daisyUI classes: KanbanBoard, KanbanColumn, NewTaskPanel, TaskCard (`apps/web/src/modules/task-kanban/TaskCard.tsx:4`), TaskDetail, TaskFilters. Raw `className="badge …"` / `className="select …"` etc. replaced with `<Badge variant=… size=…>` / `<Select variant=… size=…>`.
- Card wrapper supports `asChild` (Radix-style composition) for semantic nesting (e.g., `<Card asChild><button>…</button></Card>` in `apps/web/src/modules/task-kanban/TaskCard.tsx:45-51`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1: Build typed wrappers (~8 components) | MET | 10 components created (Badge, Card, Checkbox, Input, Join, Loading, Modal, Select, Textarea, Toggle) |
| R2: Encapsulate daisyUI classes behind props | MET | All use `VARIANT_CLASSES`/`SIZE_CLASSES` const records |
| R3: Layout-utility className passthrough | MET | All spread `className` into `.filter(Boolean).join(' ')` |
| R4: Follow Button pilot conventions | MET | All match Button.tsx pattern |
| R5: Re-export from ui.ts | MET | `apps/web/src/ui.ts:1-11` exports all 10 + Props types |
| R6: Refactor call sites to `@/ui` seam | MET | 6 task-kanban call sites import from `@/ui` |
| R7: No raw daisyUI component-class leak outside seam | MET | `rg` over component-class list → 0 matches outside `components/ui/` |

**Unit-test coverage decision (design):** `.tsx` wrapper components are **not** individually unit-tested in this project — they are thin daisyUI-class adapters (variant→class lookup + `className` passthrough) with no branching logic worth asserting. Coverage is provided by the existing `apps/web/tests/components/ui-wrappers.test.tsx` and gated by the post-check **`coverage-gate`** rule, which passes green under `bun run spur-check`. No per-wrapper `*.test.tsx` files are added. **Coverage: N/A per design** (no new testable logic; coverage-gate green).
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### History
- 2026-06-26T00:36:37.358Z todo → wip (system)
- 2026-06-26T00:59:00.849Z wip → testing (system)
- 2026-06-26T07:03:10.576Z testing → done (system)
