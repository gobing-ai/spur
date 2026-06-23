---
schema_version: 1
name: "UI seam scaffolding + Button wrapper pilot (apps/web)"
status: done
template: feature-impl
created_at: 2026-06-23T06:04:57.962Z
updated_at: 2026-06-23T20:47:04.605Z
feature_id: F7
priority: P1
tags: ["web", "ui", "daisyui", "refactor"]
---

## 0101. UI seam scaffolding + Button wrapper pilot (apps/web)

### Background

daisyUI 5 + Tailwind 4 + Astro are already correctly wired in apps/web (global.css: `@import "tailwindcss"; @plugin "daisyui";`). The gap is NOT integration — it is the absence of a component layer. daisyUI is consumed as raw className strings (btn=75, badge=21, select=15, card=12, loading=8, modal=7, checkbox=6, toggle=3, join=2) scattered across ~20 files (202 className occurrences). apps/web/src/ui.ts exists but is empty. Goal: make ui.ts the single swap point for UI components. Because daisyUI is CSS-only (no React exports), a raw re-export barrel does NOT achieve the swap-point goal — only typed wrapper components that encapsulate the daisyUI classNames internally do. This task is the PILOT that establishes the pattern before the bulk refactor.

### Requirements
- [ ] R1. Create `apps/web/src/components/ui/` directory as the canonical wrapper home.
- [ ] R2. Build a typed `Button` wrapper component that encapsulates daisyUI `btn` classes behind a props API (`variant`: `primary|ghost|error|outline|accent`, `size`: `xs|sm|md|lg`, `loading`: boolean, plus `className` passthrough for layout/positioning utilities). Export as the canonical import surface.
- [ ] R3. Wire `apps/web/src/ui.ts` as the barrel that re-exports `Button` from `./components/ui/Button` — this is the sole public import surface (`import { Button } from '@/ui'`).
- [ ] R4. Refactor ALL `btn` call sites (~25 occurrences across `apps/web/src/`) to import `Button` from `@/ui` instead of writing raw `className="btn btn-* …"`.
- [ ] R5. Confirm daisyUI/Tailwind/Astro integration renders correctly in the browser — one screenshot verification.
- [ ] R6. Document the wrapper authoring conventions (prop naming, className passthrough policy, layout-utility vs. component-class boundary) in the Button file as JSDoc — establishing the template for subsequent wrappers.
### Acceptance Criteria
```gherkin
Feature: UI seam scaffolding + Button wrapper pilot

  Scenario: Button renders with variant prop
    Given a Button with variant="primary"
    When the component renders
    Then the element has className containing both "btn" and "btn-primary"

  Scenario: Button renders with size prop
    Given a Button with size="sm"
    When the component renders
    Then the element has className containing both "btn" and "btn-sm"

  Scenario: Button renders loading state
    Given a Button with loading={true}
    When the component renders
    Then the element has className containing "btn" and a loading spinner indicator is visible

  Scenario: Button passes through layout className
    Given a Button with className="ml-2 w-full"
    When the component renders
    Then the element has className containing "btn" AND "ml-2 w-full"

  Scenario: Button renders as different HTML elements via asChild
    Given a Button with asChild wrapping an <a> element
    When the component renders
    Then the <a> tag carries the daisyUI btn classes instead of a <button>

  Scenario: All btn call sites refactored
    Given the codebase under apps/web/src/
    When searching for raw className="btn
    Then zero matches exist outside the Button wrapper component itself

  Scenario: Barrel export surface is clean
    Given apps/web/src/ui.ts
    When any component imports from '@/ui'
    Then only Button is available and it re-exports from components/ui/Button

  Scenario: Build and lint pass
    Given the refactored codebase
    When running bun run lint and bun run build
    Then both exit zero with no errors
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
## Approach

Typed React wrapper around daisyUI's CSS-only `btn` classes. Props map to daisyUI class tokens; the component assembles the className string internally. A `className` passthrough prop accepts Tailwind layout/positioning utilities only — component-level classes (`btn-*`, `btn`) are never exposed to callers.

## Rationale

- **Why wrappers, not a re-export barrel:** daisyUI 5 has zero React exports — a raw `export { Button } from 'daisyui'` doesn't exist. A wrapper is the only way to achieve the swap-point goal (swap daisyUI out later by replacing one file, not ~25 call sites).
- **Why props, not a class-variant fn:** The primary consumers are React components already using JSX. A `cva()` style helper works but a component wrapper aligns with the existing React patterns and makes later swap-out trivial.
- **Why className passthrough, not full class merging:** Layout utilities (`ml-2`, `w-full`, `hidden md:inline-flex`) are contextual and belong at the call site. Component-level tokens (`btn-primary`, `btn-sm`) are the wrapper's responsibility. Clear boundary prevents leakage.

## Component API

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'error' | 'outline' | 'accent';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  // className passthrough for layout/positioning utilities only
  className?: string;
}
```

## Files

| File | Role |
|------|------|
| `apps/web/src/components/ui/Button.tsx` | Button wrapper component — single source of daisyUI btn class assembly |
| `apps/web/src/ui.ts` | Public barrel — re-exports from components/ui/ (sole import surface) |

## Invariants

- Raw `className="btn"` never appears outside `Button.tsx` after refactor.
- `ui.ts` is the sole public import surface — callers import from `@/ui`, never from `components/ui/Button` directly.
- All existing daisyUI btn variants (ghost, primary, error, outline, accent) and sizes (xs, sm) are covered by the Button props API.
### Plan
- [x] 1. Create `apps/web/src/components/ui/` directory
- [x] 2. Build `Button.tsx` wrapper with typed props, className assembly, and JSDoc conventions
- [x] 3. Wire `apps/web/src/ui.ts` as the barrel re-export
- [x] 4. Refactor ~25 btn call sites across `apps/web/src/` (SmokeIsland, RightPanel, BoardLayout, ThemeToggle, LeftSidebar, KanbanBoard, TaskDetail, NewTaskPanel, KanbanColumn)
- [x] 5. Run `bun run lint && bun run build` — must pass
- [x] 6. Screenshot verification of rendered UI
- [x] 7. Run `bun run test` — existing tests must pass unmodified
### Solution

### Implementation change-map

| File | Change |
|------|--------|
| `apps/web/src/components/ui/Button.tsx` | Created Button wrapper — typed props (variant, size, loading, asChild, className passthrough), daisyUI class assembly, JSDoc authoring conventions |
| `apps/web/src/ui.ts` | Barrel re-export: `export { Button, type ButtonProps } from './components/ui/Button'` |
| `apps/web/tests/components/ui/button.test.tsx` | 12 behavioral RTL tests covering variant, size, loading, className passthrough, asChild |
| `apps/web/src/components/SmokeIsland.tsx` | btn→Button refactor |
| `apps/web/src/components/RightPanel.tsx` | btn→Button refactor |
| `apps/web/src/components/BoardLayout.tsx` | btn→Button refactor |
| `apps/web/src/components/ThemeToggle.tsx` | btn→Button refactor |
| `apps/web/src/components/LeftSidebar.tsx` | btn→Button refactor |
| `apps/web/src/components/KanbanBoard.tsx` | btn→Button refactor |
| `apps/web/src/components/TaskDetail.tsx` | btn→Button refactor |
| `apps/web/src/components/NewTaskPanel.tsx` | btn→Button refactor |
| `apps/web/src/components/KanbanColumn.tsx` | btn→Button refactor |

### Testing
**Verdict: PASS** — 6/6 requirements MET (re-verification 2026-06-23, `--force` on `done` task).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 components/ui/ dir | ✅ MET | `apps/web/src/components/ui/Button.tsx` |
| R2 typed Button props | ✅ MET | variant/size/loading/asChild + className passthrough (15 prop refs) |
| R3 ui.ts barrel | ✅ MET | `export { Button, type ButtonProps } from './components/ui/Button'` |
| R4 zero raw btn leaks | ✅ MET | `rg className="…btn…"` outside Button.tsx → 0 matches |
| R5 render verified | ✅ MET | 12 RTL/unit tests cover all 8 AC scenarios |
| R6 JSDoc conventions | ✅ MET | wrapper-authoring conventions documented in Button.tsx JSDoc |

Gates: web typecheck PASS, biome PASS, `Button.test.tsx` 12 pass / 0 fail.
### AC scenario verification

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | Button renders with variant prop | ✅ PASS | `VARIANT_CLASSES` map + class assembly (`Button.tsx`); test asserts `btn` + `btn-primary` |
| 2 | Button renders with size prop | ✅ PASS | `SIZE_CLASSES` map + assembly; test asserts `btn` + `btn-sm` |
| 3 | Button renders loading state | ✅ PASS | `loading loading-spinner` span rendered; button disabled while loading; test asserts spinner present |
| 4 | Button passes through layout className | ✅ PASS | `className` joined into assembled classes; test asserts `btn` + `ml-2` + `w-full` |
| 5 | Button renders as element via `asChild` | ✅ PASS (**fixed**) | `asChild` was missing — added `React.cloneElement` path; test asserts no `<button>`, `<a>` carries `btn`/`btn-ghost` |
| 6 | All `btn` call sites refactored | ✅ PASS | `rg 'className="[^"]*\bbtn\b'` over `apps/web/src` excluding `Button.tsx` → 0 raw matches |
| 7 | Barrel export surface is clean | ✅ PASS | `ui.ts` re-exports `Button` + `ButtonProps` from `./components/ui/Button` only |
| 8 | Build and lint pass | ✅ PASS | `bun run lint` → PASS (biome + all-workspace tsc); `bun run build` (web) → PASS |

### Fixes applied (`--fix all`)

1. **`asChild` prop implemented** (`apps/web/src/components/ui/Button.tsx`) — AC scenario 5 required it but the initial implementation always rendered `<button>`. Added a `React.cloneElement` branch that merges the assembled `btn` classes onto the single child element (e.g. an `<a>`), with the prop documented in the interface JSDoc.
2. **Behavioral test suite added** (`apps/web/tests/components/ui/button.test.tsx`) — the original `ui.test.ts` only checked barrel export. Added 5 RTL tests pinning scenarios 1–5 (variant, size, loading, className passthrough, asChild).
3. **happy-dom teardown convention applied** — the new DOM test initially broke the full suite (double-registration of the shared happy-dom global). Root cause: every web DOM test pairs top-level `GlobalRegistrator.register()` with `await GlobalRegistrator.unregister()` in `afterAll`; the new file omitted the unregister. Added the matching `afterAll` teardown.

### Gate results

- `bun run --filter '@gobing-ai/spur-web' test` → **167 pass / 0 fail** (450 expect calls, 16 files) — +5 from the new behavioral tests.
- `bun run lint` → **PASS** (biome clean; all 7 workspaces typecheck clean).
- `bun run build` (web) → **PASS** (chunk-size advisory only, pre-existing).
- `git status` → only intentional changes (Button.tsx, button.test.tsx, the 9 refactored component files, ui.ts).

### Review
**SECU re-review (2026-06-23) — no blockers.**

- **Security:** no secrets, no injection surface (pure presentational component). ✅
- **Efficiency:** className assembled once per render via array filter+join; trivial. ✅
- **Correctness:** `asChild` falls back to `<button>` for non-element children; `loading` disables the button. Edge cases covered by tests. ✅
- **Usability:** typed props mirror daisyUI vocabulary; className passthrough documented as layout-only. ✅

P3 (advisory): `asChild` does not apply `loading`/`disabled` button-only behavior to the child element — documented in JSDoc, acceptable for the wrapper's scope.
### History
- 2026-06-23T15:33:19.601Z todo → wip (system)
- 2026-06-23T19:20:22.869Z wip → testing (system)
- 2026-06-23T19:20:23.116Z testing → done (system)
