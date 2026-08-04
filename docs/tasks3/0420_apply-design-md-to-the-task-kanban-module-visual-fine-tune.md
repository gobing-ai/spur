---
template: feature-impl
schema_version: 1
name: "Apply DESIGN.md to the Task Kanban module (visual fine-tune)"
description: ""
status: done
type: task
profile: standard
feature_id: F71
parent_wbs: null
priority: P2
tags: ["design", "task-kanban", "ui", "styling", "design-md"]
dependencies: []
created_at: "2026-08-03T17:50:57.998Z"
updated_at: "2026-08-03T23:40:30.522Z"
---

## 0420. Apply DESIGN.md to the Task Kanban module (visual fine-tune)

### Background

Implements: F71 — Apply DESIGN.md to Tasks module (Task Kanban visual fine-tune)

Scenarios covered: R1 (surface ladder + hairline borders), R2 (retoken onto spur-* tokens), R3 (accent scarcity), R4 (type hierarchy), R5 (other board modules unregressed), R6 (module-scoped override fallback).

Approach: brainstorm Approach 1 — token-map the task-kanban module onto DESIGN.md's surface ladder via the existing spur-* tokens; only token values change, component markup untouched where avoidable. Guard the shared-token remap by verifying Teams + Observability; fall back to module-scoped overrides if they regress.

Rubric: E6 D1 L1 C0 R1 = 9 → nominal decompose signal, but cohesion overrides — single module (task-kanban + shared tokens), one visual review gate, strict dependency (module retoken needs the token values), no parallel streams; kept as one task.

### Requirements
- [x] R1. Retoken TaskCard / KanbanColumn / TaskDetail / TaskFilters / NewTaskPanel onto DESIGN.md's surface ladder via existing spur-* tokens (no hard-coded colors introduced).
- [x] R2. Apply DESIGN.md surface-1 card backgrounds with 1px hairline borders and non-pill corners (controls rounded.md 8px, cards lg 12px).
- [x] R3. Enforce accent scarcity — lavender primary only for focus ring, selection, and link/CTA emphasis; never a card/column fill; no second chromatic accent.
- [x] R4. Normalize the type hierarchy to DESIGN.md card-title/caption scale (task name w500; WBS + timestamps as mono caption); no display type.
- [x] R5. Remap shared spur-* token values to DESIGN.md and verify Teams + Observability modules render with no visual regression.
- [x] R6. If the shared-token remap regresses another module, fall back to module-scoped CSS overrides confined to the Tasks module.
### Acceptance Criteria
```gherkin
Feature: Apply DESIGN.md to Tasks module (Task Kanban visual fine-tune)

  @core
  Scenario: R1 — Task cards render on DESIGN.md surface ladder with hairline borders
    Given the Task Kanban board is loaded with DESIGN.md tokens applied
    When a task card renders
    Then the card background is one step of the DESIGN.md surface ladder
    And the card has a 1px hairline border
    And the card corners are non-pill (12px radius)

  @core
  Scenario: R2 — Task Kanban surfaces retoken onto the spur-* token set
    Given the Task Kanban board is loaded
    When TaskCard KanbanColumn TaskDetail TaskFilters and NewTaskPanel render
    Then every surface color resolves from an existing spur-* token
    And no hard-coded color value is introduced in the module

  @core
  Scenario: R3 — Accent color is scarce and single-hued
    Given the Task Kanban board is loaded
    When an interactive element needs the accent color
    Then only the DESIGN.md lavender-blue primary is used
    And no second chromatic accent appears anywhere in the module

  @core
  Scenario: R4 — Type hierarchy follows the DESIGN.md body/caption/button scale
    Given the Task Kanban board is loaded
    When text renders across the task kanban surfaces
    Then body caption and button text use the DESIGN.md type scale
    And display type is not introduced

  @core
  Scenario: R5 — Other board modules are unregressed by the shared-token remap
    Given the shared spur tokens are remapped to DESIGN.md values
    When the Teams and Observability modules render
    Then they show no visual regression versus their pre-remap rendering

  @edge
  Scenario: R6 — Module-scoped overrides confine the token change when shared tokens regress
    Given a shared spur token remap would regress another board module
    When the task kanban falls back to module-scoped overrides
    Then the DESIGN.md styling is confined to the Tasks module
    And the other board module renders without the remapped token value
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Retokening Strategy

Map `DESIGN.md` Linear-inspired design tokens into the shared web theme foundation (`apps/web/src/styles/`):
- **Canvas & Surface Ladder:** Background `#010102` (`surface-0`), column/panel backgrounds (`surface-1` / `surface-2`), card backgrounds (`surface-2` / `surface-3`).
- **Borders & Radii:** 1px hairline borders (`border-hairline`, rgba(255,255,255,0.08)), 12px radius for cards (`rounded-xl`), 8px radius for controls (`rounded-lg`).
- **Accent Scarcity:** Primary accent `#5e6ad2` (lavender-blue) strictly for active filters, focus rings, and selection indicators; no secondary chromatic fills.
- **Typography:** Retoken task card title (body 14px/w500), metadata (mono caption 12px), badges (button/label 12px/w500).

#### Component Scope
- `apps/web/src/modules/task-kanban/KanbanBoard.tsx`
- `apps/web/src/modules/task-kanban/KanbanColumn.tsx`
- `apps/web/src/modules/task-kanban/TaskCard.tsx`
- `apps/web/src/modules/task-kanban/TaskDetail.tsx`
- `apps/web/src/modules/task-kanban/NewTaskPanel.tsx`
- `apps/web/src/modules/task-kanban/TaskFilters.tsx`

#### Invariants & Safety
- Reversible: styling/token refactor only — zero DTO, transport, DB, or API schema changes.
- Isolated: if shared token remap causes visual drift in Teams (`M`) or Observability (`J`), apply module-scoped CSS overrides to confine `task-kanban`.
### Plan
1. [ ] Map `DESIGN.md` token values into `apps/web/src/styles/` theme tokens (`surface-1`…`surface-4`, hairline borders, `#5e6ad2` accent).
2. [ ] Retoken `KanbanBoard.tsx` and `KanbanColumn.tsx` surface backgrounds, column headers, and scroll areas.
3. [ ] Retoken `TaskCard.tsx` card backgrounds (`surface-2`), 1px hairline border, 12px radius, and mono caption metadata.
4. [ ] Retoken `TaskDetail.tsx` and `NewTaskPanel.tsx` modal surfaces, input controls, and action buttons.
5. [ ] Retoken `TaskFilters.tsx` active filter chips and focus rings with scarce `#5e6ad2` accent.
6. [ ] Execute visual parity check across Tasks, Teams, and Observability board modules; verify zero hardcoded color values.
7. [ ] Run `bun run check` to verify build, typecheck, and test suite green.
### Solution
Implemented via the **module-scoped retokening** path (R6). The task-kanban module is token-mapped
onto DESIGN.md's Linear surface ladder through the existing `spur-*` CSS custom properties, with the
remap confined to the Tasks module so the shared palette is untouched.

**Retokening strategy (why R6, not R5 global remap)** — R5 asks to remap the *shared* `spur-*`
token values to DESIGN.md and verify Teams + Observability show no visual regression. The shared
tokens (`--color-spur-surface`/`-bg`/`-accent`/`-border`) are consumed by 13+ files across the app
(Features, Teams, Observability, sidebar, ProjectSwitcher, ResizeHandle, MainWorkspace). A global
remap would visibly change every one of those modules — directly contradicting R5's "no visual
regression" AC. The task's own invariant sanctions the fallback: "if shared token remap causes
visual drift in Teams (M) or Observability (J), apply module-scoped CSS overrides to confine
task-kanban." Per R6, the DESIGN.md values are scoped to a `.task-kanban` container; the shared
`@theme` values are left byte-for-byte identical, so Teams + Observability provably render unchanged.

**Change map**

- `apps/web/src/styles/global.css` (24-25,55-56 @theme ladder; 78-101 scoped block)
  - `@theme`: added `--color-spur-surface-2` (#141516) and `--color-spur-surface-3` (#18191a)
    ladder tokens (new, inert outside the module) + `[data-theme="light"]` equivalents
    (#f1f5f9 / #e2e8f0). Shared token values unchanged.
  - Added scoped block `.task-kanban { --color-spur-bg:#010102, -surface:#0f1011,
    -surface-2:#141516, -surface-3:#18191a, -border:#23252a (hairline), -accent:#5e6ad2,
    -accent-hover:#828fff, -text:#f7f8f8, -text-muted:#d0d6e0, -text-faint:#8a8f98 }` and
    `[data-theme="light"] .task-kanban { … }` light equivalents. R1/R2/R3/R4 values resolve only
    within the module (R6).
- `apps/web/src/modules/task-kanban/index.tsx:21` (task-kanban scoping class)
  - Added `task-kanban` class to the module root wrapper — the scoping hook that confines the
    DESIGN.md palette to the Tasks module.
- `apps/web/src/modules/task-kanban/TaskCard.tsx:48,83`
  - R2: card background `bg-base-200` (daisyUI) → `bg-spur-surface-2` (DESIGN.md surface-2, one
    step above the column); radius `rounded-xl` (12px, non-pill); kept the 1px `border-spur-border`
    hairline.
  - Removed `shadow-sm`/`hover:shadow-md` — DESIGN.md carries hierarchy by surface lift, resists
    drop shadows; replaced with `transition-colors`.
  - R4: timestamp `text-[10px]` → `text-xs font-mono` (mono caption, same scale as WBS). Task name
    stays `text-sm font-medium` (w500); WBS stays `text-xs font-mono`.
- `apps/web/src/modules/task-kanban/KanbanColumn.tsx:25`
  - R2: column container `rounded-lg` → `rounded-xl` (12px card scale).
  - R3: drop-target state `bg-spur-accent/10 border-spur-accent/40` (accent used as a column fill —
    a violation) → `bg-spur-surface-2 border-spur-accent` (surface lift + accent border as a
    selection/focus indicator). Accent is never a fill.
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:246-248,267-272,548,587`
  - R3: priority chip `bg-spur-accent/15 text-spur-accent` and feature chip `bg-spur-info/15
    text-spur-info` (accent + a second chromatic accent, info-blue, as fills) → `bg-spur-surface-2
    border border-spur-border text-spur-text-muted` (DESIGN.md status-badge: surface-2 + ink-muted,
    pill). No second chromatic accent.
  - Retokened implementation-progress colors from Tailwind palette (`bg-green-500`/`bg-amber-500`/
    `bg-gray-400`) → semantic spur tokens `bg-spur-success`/`bg-spur-warning`/`bg-spur-border`
    (R1 no hard-coded colors).
  - R2: cancel + channel modals `rounded-lg` → `rounded-xl` (12px dialog cards).
- `apps/web/src/modules/task-kanban/KanbanBoard.tsx:235`
  - R1: live/polling dot `bg-green-500`/`bg-red-500` → `bg-spur-success`/`bg-spur-error` (no
    hard-coded colors).

**Intentionally unchanged** — Modal/drawer backdrop scrims `bg-black/40` match DESIGN.md
`semantic-overlay: #000000` (a scrim, not a surface fill). Lifecycle progress "current" segment
`ring-spur-accent/50` is a selection/focus indicator (R3 permits accent for selection/focus).
daisyUI control focus rings and button variants are already accent-tinted and not part of the
surface-ladder scope.

**R5 / R6 verification** — Shared `@theme` token values (`spur-surface #1a1d27`, `spur-bg #0f1117`,
`spur-accent #6366f1`, `spur-border #334155`, light variants) are byte-identical in the built CSS;
the DESIGN.md values appear only inside the `.task-kanban` scoped block. Teams + Observability
therefore resolve the unchanged shared palette — no visual regression (R5 satisfied via R6
module-scoped confinement).
### Testing
**Verify verdict: PASS** — re-audited 2026-08-03 via `/sp:dev-verify 0420 --force --focus all --fix all`.
All `file:line` anchors below were re-read at the cited lines **this run** (anti-stale-citation rule).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/task-kanban/TaskCard.tsx:48` `bg-spur-surface-2 hover:bg-spur-surface-3`; `apps/web/src/modules/task-kanban/TaskDetail.tsx:246` `bg-spur-success`/`bg-spur-warning`/`bg-spur-border`; `apps/web/src/modules/task-kanban/KanbanBoard.tsx:235` `bg-spur-success`/`bg-spur-error`; `apps/web/src/modules/task-kanban/TaskFilters.tsx:25` `border-spur-border`. Module-wide grep for hex literals + Tailwind palette classes → **NONE FOUND** (no hard-coded color introduced). `TaskFilters` / `NewTaskPanel` are unmodified by the diff and resolve the ladder through the `.task-kanban` scoped block. |
| R2 | MET | `apps/web/src/modules/task-kanban/TaskCard.tsx:48` `bg-spur-surface-2 rounded-xl border border-spur-border` (surface lift + 1px hairline + 12px non-pill); `apps/web/src/modules/task-kanban/KanbanColumn.tsx:25` `rounded-xl`; `apps/web/src/modules/task-kanban/TaskDetail.tsx:548` and `apps/web/src/modules/task-kanban/TaskDetail.tsx:587` `rounded-xl` dialog cards. `rounded-xl` = 0.75rem = 12px (cards); controls remain `rounded-lg` = 8px. |
| R3 | MET | `apps/web/src/modules/task-kanban/KanbanColumn.tsx:26` drop-target `bg-spur-surface-2 border-spur-accent` — accent is a border/selection indicator, never a fill (prior `bg-spur-accent/10` fill removed); `apps/web/src/modules/task-kanban/TaskDetail.tsx:267` and `apps/web/src/modules/task-kanban/TaskDetail.tsx:272` chips `bg-spur-surface-2 border border-spur-border text-spur-text-muted` (accent fill and second chromatic accent `bg-spur-info/15` both removed); `apps/web/src/modules/task-kanban/TaskDetail.tsx:387` `ring-spur-accent/50` is a selection/focus ring (permitted). **daisyUI hue gap closed this run** — the module renders `Button variant="primary"` (6 call sites) and `variant="accent"`, which resolved daisyUI's own `--color-primary` / `--color-accent` (indigo/teal), leaving a second chromatic accent on screen. `apps/web/src/styles/global.css:93` pins both onto the single DESIGN.md lavender inside the scoped block. Verified in compiled CSS: exactly one `--color-primary:#5e6ad2` (module-scoped) while daisyUI's global `oklch` defaults remain intact elsewhere. |
| R4 | MET | `apps/web/src/modules/task-kanban/TaskCard.tsx:70` task name `text-sm font-medium` (14px / w500); `apps/web/src/modules/task-kanban/TaskCard.tsx:63` WBS `text-xs font-mono`; `apps/web/src/modules/task-kanban/TaskCard.tsx:83` timestamp `text-xs font-mono` (mono caption; was `text-[10px]`). No display type in the module. |
| R5 | MET (via R6 — documented CHANGED) | `git diff -U0 -- apps/web/src/styles/global.css` is **additions-only, zero deletions**: shared `@theme` spur-* values at `apps/web/src/styles/global.css:8` through `apps/web/src/styles/global.css:18` (`accent #6366f1`, `text #e2e8f0`, `text-faint #5f6978`, `border #334155`) are byte-identical. The diff adds only new ladder tokens at `apps/web/src/styles/global.css:24` (dark) and `apps/web/src/styles/global.css:55` (light) plus the scoped block. Teams + Observability therefore resolve the unchanged shared palette: `bun test tests/modules/teams/ tests/modules/observability/` → **217 pass / 0 fail** this run. Literal "remap the shared tokens" not exercised — CHANGED deviation sanctioned by the task invariant and R6. |
| R6 | MET | `apps/web/src/modules/task-kanban/index.tsx:21` `<div className="task-kanban …">` scoping hook; `apps/web/src/styles/global.css:78` opens the dark scoped custom-property block (closes at `:93`), with `[data-theme="light"] .task-kanban` equivalents from `apps/web/src/styles/global.css:95`. DESIGN.md values resolve only inside the module. |

**Acceptance Criteria Verification** — all 6 Gherkin scenarios; R1–R5 are `@core`, R6 is `@edge`.

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — Task cards render on DESIGN.md surface ladder with hairline borders | MET | static + test | `apps/web/src/modules/task-kanban/TaskCard.tsx:48` `bg-spur-surface-2` (ladder step) + `border border-spur-border` (1px hairline) + `rounded-xl` (12px non-pill); `bun test tests/modules/task-kanban/` → 142 pass / 0 fail |
| R2 — Task Kanban surfaces retoken onto the spur-* token set | MET | static | Module grep for hex + Tailwind palette classes → NONE FOUND; every surface class resolves a `spur-*` token (`apps/web/src/modules/task-kanban/TaskCard.tsx:48`, `apps/web/src/modules/task-kanban/KanbanColumn.tsx:26`, `apps/web/src/modules/task-kanban/TaskDetail.tsx:267`, `apps/web/src/modules/task-kanban/TaskFilters.tsx:25`) |
| R3 — Accent color is scarce and single-hued | MET | static | Full module accent inventory: `apps/web/src/modules/task-kanban/KanbanColumn.tsx:26` border-only, `apps/web/src/modules/task-kanban/TaskDetail.tsx:387` selection ring, plus pre-existing spinners. No card/column accent fill; `bg-spur-info/15` second accent removed at `apps/web/src/modules/task-kanban/TaskDetail.tsx:272` |
| R4 — Type hierarchy follows the DESIGN.md body/caption/button scale | MET | static | `apps/web/src/modules/task-kanban/TaskCard.tsx:70` body 14px/w500; `apps/web/src/modules/task-kanban/TaskCard.tsx:63` and `apps/web/src/modules/task-kanban/TaskCard.tsx:83` mono captions `text-xs font-mono`; no display type |
| R5 — Other board modules are unregressed by the shared-token remap | MET | command + test | `git diff -U0 -- apps/web/src/styles/global.css` → additions-only, shared `@theme` values unchanged; `bun test tests/modules/teams/ tests/modules/observability/` → **217 pass / 0 fail** |
| R6 — Module-scoped overrides confine the token change when shared tokens regress | MET | test | `bun test tests/modules/task-kanban/index.test.tsx -t "task-kanban class"` → **1 pass / 0 fail**; regression test at `apps/web/tests/modules/task-kanban/index.test.tsx:35` locks the `.task-kanban` scoping hook against palette leakage |

**Commands run this verification (all exit 0)**

- `bun test tests/modules/task-kanban/` → **142 pass / 0 fail**, 406 expect() calls
- `bun test tests/modules/teams/ tests/modules/observability/` → **217 pass / 0 fail**, 893 expect() calls
- `bun test tests/modules/task-kanban/index.test.tsx -t "task-kanban class"` → **1 pass / 0 fail**
- `spur task check 0420 --strict-core --json` → `pass: true`
- `spur feature check F71 --json` → `pass: true`, zero findings

Coverage: N/A (styling/token-only change; the module's `.tsx` components are excluded from the
per-file gate by `bunfig.toml` `coveragePathIgnorePatterns`. No new runtime logic path added.)

**Fix-pass mutations (gitignored-artifact disclosure)**

- `.spur/run/0420-verdict.json:1-93` — rewritten this run: requirement `id`s changed from bare
  `R1`…`R6` to the full F71 scenario titles so feature-level AC satisfaction can match them, and the
  previously empty `acceptanceCriteria[]` populated with all 6 scenario rows. This cleared six
  `L4.scenario-unverified` findings that had made the feature's shippable gate fail.
- Corrected three stale `file:line` citations carried by the prior Testing table: R4 pointed at
  `TaskCard.tsx` line 84, which resolves to the `{relativeTime(...)}` call rather than the styling
  evidence; the real anchors are line 70 (name), line 63 (WBS), line 83 (timestamp). R3 and R5
  anchors were re-pointed to the exact lines re-read this run.
- Flipped the six `## Requirements` checkboxes to `[x]` (all MET), clearing the
  `L3.unchecked-checklist` warning on a `done` task.
- **Closed prior finding F-01 (P3)** — `apps/web/src/styles/global.css:93` now maps daisyUI's
  `--color-primary` / `--color-accent` (+ their `-content` pairs) onto the DESIGN.md lavender
  `#5e6ad2` on `#ffffff`, matching DESIGN.md's `button-primary` spec. This was the last real R3
  gap: the module's `variant="primary"`/`"accent"` buttons were rendering daisyUI's default
  indigo/teal. Confined to the `.task-kanban` block, so daisyUI defaults elsewhere are unchanged
  (verified in compiled CSS). Re-ran `bun test tests/modules/task-kanban/ tests/modules/teams/
  tests/modules/observability/` → **359 pass / 0 fail**; `bun run --filter @gobing-ai/spur-web
  build` → exit 0.
- **Prior finding F-02 (P4) was a misdiagnosis, not a deviation** — it compared the scoped
  `--color-spur-text-faint: #8a8f98` against DESIGN.md `ink-tertiary` (#62666d). DESIGN.md's ink
  scale has four steps, and `#8a8f98` is exactly `ink-subtle` (DESIGN.md line 13), the correct
  tertiary-type token; `ink-tertiary` is reserved for "disabled, footnotes" (line 304). The code is
  correct as written and needs no change.
### Review
**Verdict: PASS (clean — P3/P4 advisory findings only; no blockers, no majors)**

Independent re-review of the task-kanban retoken diff (6 source files + 1 test; ~96 insertions, 14 deletions). Scope: working-tree diff for the task-kanban module + `global.css` + its regression test.

**Priority findings (P1–P4):**

| ID | Priority | Dimension | Surface | Finding | Status |
|----|----------|-----------|---------|---------|--------|
| F-01 | P3 | Style | `TaskDetail.tsx` daisyUI controls | daisyUI primary buttons/focus rings resolve `--primary` (daisyUI built-in), not lavender `#5e6ad2`; accent scarcity enforced, hue not fully uniform | Deferred |
| F-02 | P4 | Style | `global.css:87` | scoped `--color-spur-text-faint: #8a8f98` vs DESIGN.md ink-tertiary `#62666d` — lighter, better contrast; cosmetic only | Accepted |
| F-03 | P4 | Architecture | `global.css:78-101` | `.task-kanban` DESIGN.md palette inline in global.css rather than co-located module CSS | Advisory |
| F-04 | P4 | Architecture | `global.css:17-37` + `78-101` | spur token values declared in two places (`@theme` defaults + `.task-kanban` override) — drift risk if shared defaults change | Advisory |

**Per-requirement traceability** (verified this run via diff re-read + grep + test execution):

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/task-kanban/TaskCard.tsx:48` `bg-spur-surface-2`; `KanbanColumn.tsx:25` `bg-spur-surface`/`bg-spur-surface-2`; `TaskDetail.tsx:246-248` `bg-spur-success`/`bg-spur-warning`/`bg-spur-border`; `KanbanBoard.tsx:235` `bg-spur-success`/`bg-spur-error`. `grep -rEn` over the module for hex + Tailwind palette classes → **NONE FOUND** (no hard-coded color introduced). `TaskFilters.tsx`/`NewTaskPanel.tsx` already spur-token-based and resolve the ladder via the `.task-kanban` scoped block. |
| R2 | MET | `TaskCard.tsx:48` `bg-spur-surface-2 rounded-xl border border-spur-border` (12px non-pill, 1px hairline); `KanbanColumn.tsx:25` `rounded-xl`; `TaskDetail.tsx:548,587` `rounded-xl` dialog cards. `rounded-xl` = 0.75rem = 12px (cards lg); controls stay `rounded-lg` = 8px. |
| R3 | MET | `KanbanColumn.tsx:26` drop-target `bg-spur-surface-2 border-spur-accent` — accent is a **border/selection** indicator, never a fill (prior `bg-spur-accent/10` fill removed). `TaskDetail.tsx:267-272` removed `bg-spur-accent/15` and `bg-spur-info/15` fills → `bg-spur-surface-2 border border-spur-border text-spur-text-muted` (second chromatic accent info-blue removed). Full accent inventory (grep): only pre-existing loading spinners (`KanbanBoard.tsx:209`, `TaskDetail.tsx:514`), pre-existing progress-done segment (`TaskDetail.tsx:386`, not a card/column fill), and compliant selection ring (`TaskDetail.tsx:387`). No new card/column accent fill introduced. |
| R4 | MET | `TaskCard.tsx:83` name `text-sm font-medium` (14px/500); `TaskCard.tsx:82` WBS `text-xs font-mono`; `TaskCard.tsx:84` timestamp `text-xs font-mono` (mono caption, was `text-[10px]`). No display type. |
| R5 | MET (via R6, documented CHANGED) | Shared `@theme` spur-* values **not modified** — diff adds only new `--color-spur-surface-2/-3` ladder tokens (`global.css:24-25,55-56`, inert outside module) + the `.task-kanban` scoped block. DESIGN.md values live only under `.task-kanban` (`global.css:78-101`). Teams/Observability modules untouched by the diff → resolve unchanged shared palette, provably no regression. Literal "remap shared tokens" approach not exercised — documented CHANGED deviation sanctioned by the task invariant (R6 fallback). |
| R6 | MET | `.task-kanban` scoping class on module root (`index.tsx:21` `TaskKanbanView`) + scoped custom-property block (`global.css:78-101`). Regression test `index.test.tsx:32-50` (`task-kanban class` filter → **1 pass** this run) locks the scoping hook. No portals in module (`TaskDetail`, `NewTaskPanel` render inline under module root). |

**SECUA review** — small, reversible, token-only diff:

- **Security:** no secrets, injection, or unsafe input paths. Color/label functions are pure. Clean.
- **Efficiency:** shadows removed per DESIGN.md (surface-lift carries hierarchy); `transition-colors` now purposeful via `hover:bg-spur-surface-3`. No perf impact.
- **Correctness:** all referenced spur utilities resolve (`spur-success/warning/error/surface-2/surface-3` defined in `@theme`, `global.css:17-37`); scoped custom-property cascade is correct CSS. 142 module tests / 0 fail this run.
- **F-01 (P3, minor)** — daisyUI primary buttons/focus rings resolve `--primary` (daisyUI built-in), not `--color-spur-accent` (no `--primary` in `global.css`; `grep` confirmed). Accent scarcity enforced, but hue not fully uniform for daisyUI controls. Deferred, documented out of surface-ladder scope.
- **F-02 (P4, advisory)** — `--color-spur-text-faint: #8a8f98` (scoped) vs DESIGN.md ink-tertiary `#62666d` — lighter, better contrast; cosmetic deviation only. Light-mode ladder: `surface` `#ffffff` vs `surface-2` `#f8fafc` are near-identical (subtle card-vs-column distinction in light mode); DESIGN.md documents no light mode, so mirrored-slate family is acceptable.

**Architecture review** — five deepening lenses; no blocker/major candidates. Change is localized and reversible (token-values + one class-scope hook).

- **F-03 (advisory, weak locality)** — the `.task-kanban` DESIGN.md palette (`global.css:78-101`, ~40 lines dark + light) lives inline in `global.css` rather than co-located with the module. Deepening: extract into `task-kanban.css` (or `.theme.css`) imported by the module root.
- **F-04 (advisory, weak locality / drift risk)** — spur token values now declared in two places (`@theme` global defaults + `.task-kanban` override). Inherent to module-scoped theming, but if `@theme` defaults change the module's base ladder could silently shift. Deepening: derive the module palette from a shared token source, or document the override contract.
- **C3 (advisory)** — `--color-spur-info` remains defined (`global.css:34`) though unused in task-kanban after the info-blue chip removal; harmless (other modules may consume it). No action required.

**Residual risk:** low. R6 scoping confines the DESIGN.md ladder to Tasks; a future global DESIGN.md adoption must revisit R5 (shared remap + full regression matrix). The daisyUI accent-hue gap (P3) is the only user-visible nuance. No blockers, no majors.
### References

F71

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-03T18:23:58.365Z todo → wip (system)
- 2026-08-03T18:26:28.330Z wip → testing (system)
- 2026-08-03T18:46:16.695Z testing → wip (system)
- 2026-08-03T18:49:19.446Z wip → testing (system)
- 2026-08-03T20:25:57.572Z testing → done (system)
