---
schema_version: 1
name: "Spur Board layout polish and Open Design visual verification"
status: todo
template: feature-impl
created_at: 2026-09-06T03:28:02.402Z
updated_at: "2026-09-06T03:49:42.870Z"
feature_id: A7
priority: P2
tags: ["web", "layout", "open-design"]
dependencies: ["0773", "0774"]
---

## 0775. Spur Board layout polish and Open Design visual verification

### Background
Closing task for feature A7: after 0773 refolds the rail and 0774 hoists the agent bar, verify the
board's layout hierarchy, spacing, and theme contrast hold across viewports and both themes. Lands
feature A7 scenarios **R4** and **R6**.

**Verified ground truth (2026-09-05, current tree):**

| Claim | Verified state |
| --- | --- |
| Layout CSS | `apps/web/src/styles/board-layout.css` — 5-track grid (`--sidebar-w`, 4px handle, `1fr`, 4px handle, `--rightpanel-w`), `grid-template-rows: 100vh`, `html,body{overflow:hidden}` |
| Collapse tracks | `[data-sidebar-collapsed="true"]` → `--sidebar-w: 48px`, handle `0px` + `visibility:hidden`; `[data-rightpanel-collapsed="true"]` → both `0px` |
| Mobile (`≤767px`) | Single column; sidebar → fixed drawer `max-width:280px`, `translateX(-100%)`, 200ms; right panel → bottom sheet `max-height:60vh`, `translateY(100%)`, 250ms; `.mobile-bar` shown |
| **DEFECT 1 — dead backdrop** | `BoardLayout.tsx:126-132` renders the *only interactive* backdrop (`fixed inset-0 z-40 bg-black/50 md:hidden`, `onClick={closeMobile}`). `board-layout.css` also paints `.board-layout::before` / `::after` at **`z-index:49`** with default `pointer-events:auto` — they sit **above** the z-40 div and swallow the click, so tapping the scrim does **not** close the drawer or the sheet. Also double-darkens (0.5 then 0.4 ≈ 0.7 effective). Directly contradicts A7 R4 "backdrops and toggles function seamlessly". |
| Shared theme tokens | `src/styles/global.css` `@theme`: bg `#0f1117`, surface `#1a1d27`, border `#334155`, accent `#6366f1`. `[data-theme="light"]`: `#ffffff` / `#f8fafc` / `#e2e8f0` / `#4f46e5`. |
| **Module-scoped ladder** | `.task-kanban` (0420 R6) and `.inbox` (0422 R13) *deliberately* re-resolve the same `spur-*` custom properties to DESIGN.md's Linear ladder — `#010102` / `#0f1011` / `#141516` / `#18191a`, hairline `#23252a`, single accent `#5e6ad2` (+ daisyUI `--color-primary`/`--color-accent` pinned). Scoping is intentional: a global remap would visibly change the 13+ files consuming the shared palette. **Two ladders coexist by design; 0775 must not unify them.** |
| **DEFECT 2 — stale doc tokens** | `docs/design/board-ui-layout-and-global-agent-bar.md` §5 claims surface `#161922`, border `#252936` — **neither hex exists anywhere in `global.css`**. Pure invention; correct to the real shared values. |
| UI SSOT | Root `DESIGN.md` governs, but is authored as a **marketing** system ("product-focused marketing canvas"; pricing cards, CTA banners, testimonial cards, "don't ship a light-mode marketing page"). Its surface ladder, 4px spacing base, and single-accent rule transfer to the board; its breakpoint table (1440/1280/1024/768/480) and CTA specs describe a landing page the board does not have — the board uses one `max-width:767px` breakpoint. Accepted gap, not a defect. |
| Web suite | `apps/web/package.json` → `"test": "bun test tests"`; **48** test files under `apps/web/tests/` |
| `SettingsModal.tsx` | Does not exist yet — **created by task 0773**, not here (see Q&A) |
| Open Design MCP | `mcp__open-design__*` tools available in-session; no project pinned to this feature |
### Requirements
- **R1.** Tapping the mobile scrim closes an open drawer or bottom sheet, and the scrim renders as a
  single layer at one opacity — no stacked pseudo-element over the interactive backdrop.
- **R2.** `BoardLayout` and `board-layout.css` present one container language: border treatment,
  header alignment, and canvas padding read the same on every module route in both collapse states
  and at 375px / 768px / 1280px, with no horizontal overflow and no clipped drawer content.
- **R3.** `SettingsModal` (created by task 0773) resolves the same shared surface/border tokens and
  the same `Modal` primitive as the rest of the shell; divergences are corrected. This task does
  **not** create it — see Q&A.
- **R4.** `docs/design/board-ui-layout-and-global-agent-bar.md` §5 carries the token values actually
  present in `apps/web/src/styles/global.css`; no invented hex remains in the A7 design doc.
- **R5.** Shell surfaces (sidebar rail + footer, agent bar, settings modal, mobile bar) are inspected
  against root `DESIGN.md` and the Open Design prototype in both themes; every finding is recorded in
  `## Solution` as **pass**, **fixed**, or **accepted-gap** with a one-line reason.
- **R6.** `cd apps/web && bun test tests` passes with zero regressions, and repo-root
  `bun run spur-check` is green.

**Out of scope:** unifying the two token ladders — `.task-kanban` (0420 R6) and `.inbox` (0422 R13)
scope DESIGN.md's Linear palette *deliberately*, and a global `@theme` remap would repaint 13+ files;
any new module, route, or component; changing `--sidebar-w` / `--rightpanel-w` defaults or the
collapsed 48px rail (frozen by 0773); agent-bar behavior beyond its position and stacking (owned by
0774); editing root `DESIGN.md` — drift against it is reported in `## Solution`, never patched away.
### Acceptance Criteria
```gherkin
  @core
  Scenario: R4 — Cohesive Board layout hierarchy and responsive spacing
    Given the board layout across desktop and mobile viewports
    When navigating between modules
    Then layout borders, glassmorphic headers, and canvas paddings remain visually aligned and consistent
    And mobile drawer backdrops and toggles function seamlessly without clipping content

  @core
  Scenario: R6 — Open Design prototyping alignment and visual verification
    Given the layout components and global agent interface
    When tested against Open Design prototype specifications
    Then design tokens, typography, component spacing, and dark/light theme contrasts pass visual inspection
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T03:49:42.132Z

**Q: 0775 R2 originally said "create `SettingsModal` placeholder" — but 0773 R2 ships the settings
button that opens it. Who owns the file?**
A (closed): **0773 owns `apps/web/src/components/SettingsModal.tsx`.** Splitting the button from the
modal across two tasks would land a dead control at the end of 0773 and leave the feature broken
between commits. 0775 R3 is correspondingly narrowed to *verifying and polishing* the modal against
the shell's container language. Mirrored in 0773's Q&A.

**Q: Should 0775 remap the shared `@theme` palette onto DESIGN.md's Linear ladder, so the whole
board matches `.task-kanban` and `.inbox`?**
A (closed, no): scoping is a recorded decision, not an oversight — `global.css:64-77` and `:118-125`
state that a global remap would visibly change the 13+ files consuming the shared tokens and violate
0420 R5's "no visual regression". A palette migration is its own feature, sized against every module.
0775 records the two-ladder state as an **accepted-gap** finding and verifies each shell surface
against the palette it actually resolves.

**Q: Root `DESIGN.md` is a marketing design system. How much of it binds the board?**
A (closed): the surface ladder, 4px spacing base, single-accent rule, negative display tracking, and
touch-target minimums transfer. The breakpoint table (1440/1280/1024/768/480), pricing/CTA/testimonial
component specs, and "no light mode" describe a landing page the board does not have — the board ships
one `max-width:767px` breakpoint and a working light theme. Divergence there is **accepted-gap**, not
a fix. Not deferred to anyone: no owner is needed because nothing is pending.

**Q: Fix the dead mobile backdrop by raising the React div's z-index, or by deleting the CSS
pseudo-elements?**
A (closed): **delete `.board-layout::before` / `::after`.** `showBackdrop = mobileSidebarOpen ||
mobilePanelOpen` already covers both overlays with one element that is clickable and
keyboard-dismissible; the pseudo-elements are a duplicate scrim that only ever subtracted behavior.
Raising the z-index would keep two scrims and the doubled opacity. Deletion is the smaller diff and
the root-cause fix.

**Q: What if Open Design has no pinned project for A7?**
A (deferred — owner: implementer at execution time): if `mcp__open-design__get_active_context`
returns no A7 project, R5's prototype comparison degrades to a `DESIGN.md`-only inspection and the
`## Solution` entry says so explicitly. Do **not** create an Open Design project as part of this task.
### Design
#### WHAT

A verification-and-repair pass over the board shell, not a redesign. Two concrete defects are fixed
(dead mobile backdrop, stale design-doc tokens); everything else is an inspection that ends in a
written verdict. No new component, route, or module.

#### WHY

A7 R4 and R6 are the feature's only *quality* scenarios — every other task adds surface. This task is
where the added surface is checked against the shell it joined. Its output is evidence, so the
`## Solution` section is a deliverable, not a summary.

#### WHERE (primary file targets)

| File | Change |
| --- | --- |
| `apps/web/src/styles/board-layout.css` | **Delete** `.board-layout[data-mobile-sidebar-open="true"]::before` and `.board-layout[data-mobile-panel-open="true"]::after`; normalize `.mobile-bar` padding |
| `apps/web/src/components/SettingsModal.tsx` | Token/spacing polish only (file authored by 0773) |
| `apps/web/src/components/LeftSidebar.tsx` | Footer padding only, if the R2 rhythm check fails |
| `docs/design/board-ui-layout-and-global-agent-bar.md` | §5 token table corrected |
| `apps/web/tests/components/BoardLayout.test.tsx` | One regression test for backdrop dismissal |

#### Frozen decisions

**Backdrop (R1).** One backdrop element, owned by React. `board-layout.css` keeps the drawer/sheet
*transforms* and loses both scrim pseudo-elements. `BoardLayout.tsx:126-132` is unchanged — it is
already correct (`z-40`, `bg-black/50`, `onClick={closeMobile}`, `onKeyDown`, `aria-hidden`,
`md:hidden`). Do **not** raise its z-index; nothing will be above it once the pseudo-elements are gone.

**Container language (R2)** — the shell's existing header idiom, already used identically by
`LeftSidebar.tsx:97` and `RightPanel.tsx:22`, is the reference:

```text
p-3 border-b border-spur-border shrink-0        ← every shell chrome bar
```

Precedence when a surface diverges: **match the reference idiom** → if it cannot (mobile bar is CSS,
not Tailwind), express the same values (`padding: 0.75rem; border-bottom: 1px solid
var(--color-spur-border)`) → only then record an accepted-gap. Known candidates, both to be resolved
this way and not left to taste:

- `.mobile-bar` is `padding: 0.5rem 0.75rem` — 8px vertical against the shell's 12px.
- 0773's sidebar footer is frozen structurally as `p-2.5` (10px) — off DESIGN.md's 4px base and off
  the shell's 12px. Normalizing it to `p-3` is a padding change, not a structural one, so it does not
  break 0773's freeze.

**Token verification (R5).** Each shell surface is checked against **the palette it actually
resolves**, in this precedence:

1. Inside `.task-kanban` / `.inbox` → DESIGN.md Linear ladder (`#010102` / `#0f1011` / `#141516` /
   `#18191a`, hairline `#23252a`, accent `#5e6ad2`).
2. Everywhere else → shared `@theme` (`#0f1117` / `#1a1d27` / `#334155`, accent `#6366f1`), or
   `[data-theme="light"]` (`#ffffff` / `#f8fafc` / `#e2e8f0`, accent `#4f46e5`).
3. A surface that hardcodes a hex instead of a `spur-*` token → **fix**, regardless of ladder.

The two-ladder split itself is an **accepted-gap**, never a fix (see Q&A).

**Design-doc correction (R4).** §5's `#161922` / `#252936` are replaced by the three real sets above,
each labeled with its selector, plus a one-line note that `.task-kanban` / `.inbox` scope their own.

**Verdict vocabulary (R5).** `## Solution` records every inspected surface as exactly one of
**pass** / **fixed** / **accepted-gap**, each with a one-line reason. An unlabeled observation is not
a finding.

#### Anti-patterns

- Don't remap the shared `@theme` palette, and don't move `.task-kanban` / `.inbox` off their scoped
  ladders — both are recorded decisions (0420 R6, 0422 R13) protecting 13+ files.
- Don't touch `--sidebar-w`, `--rightpanel-w`, the collapsed `48px` rail, the `4px` handles, or the
  `max-width: 767px` breakpoint. 0773 froze the rail; the grid is load-bearing.
- Don't restructure the sidebar footer, the agent bar, or the settings modal — 0773 and 0774 froze
  their DOM. Padding and token corrections only.
- Don't edit root `DESIGN.md` to match the code. Drift is reported, not legislated away.
- Don't add a tooltip, popover, portal, or animation library for the inspection.
- Don't create an Open Design project; use the pinned one or say there isn't one.
- Don't reach for `--no-verify` or `.skip` if a moved test fails — the backdrop test is the point.

#### Cross-task assumptions

Assumes 0773 has landed `SettingsModal.tsx`, the sidebar footer, and the renamed/reordered modules,
and 0774 has landed `GlobalAgentBar` mounted from `BoardLayout`. If either is absent at execution
time, this task is **blocked**, not partially runnable — its whole subject is the assembled shell.

#### Handoff

Terminal task of feature A7. No dependents. On completion, `## Solution` is the feature's visual
verification record; A7 R4/R6 verify against it directly.
### Plan
1. **Precondition** — confirm 0773 and 0774 landed: `SettingsModal.tsx` and `GlobalAgentBar.tsx` both
   exist under `apps/web/src/components/`, and `rg -n "FloatingAgentBar" apps/web` is empty. If not,
   stop and report **blocked**.
2. **R1** — delete `.board-layout[data-mobile-sidebar-open="true"]::before` and
   `.board-layout[data-mobile-panel-open="true"]::after` from `board-layout.css`. Leave the
   `translateX` / `translateY` drawer rules and both `z-index: 50` overlay rules alone.
3. **R1 test** — add to `tests/components/BoardLayout.test.tsx`: open the mobile sidebar, click the
   element with `aria-hidden="true"` carrying `fixed inset-0 z-40`, assert
   `data-mobile-sidebar-open` returns to `"false"`. Repeat for the panel. This test fails against the
   pre-fix CSS only in a real browser, so also assert the stylesheet no longer declares the scrim —
   or, simpler and sufficient here, assert the single-backdrop invariant: exactly one element matches
   `[aria-hidden="true"].fixed.inset-0` while a drawer is open.
4. **R2** — set `.mobile-bar` padding to `0.75rem`; if the 0773 footer shipped as `p-2.5`, change it
   to `p-3`. Then walk every module route at 375 / 768 / 1280 in both collapse states, checking
   `border-b border-spur-border shrink-0` chrome alignment, canvas padding, and absence of horizontal
   overflow. Record each route as pass / fixed / accepted-gap.
5. **R3** — read `SettingsModal.tsx` as authored by 0773; verify it uses the `Modal` primitive
   (`src/components/ui/Modal.tsx`), resolves `spur-*` tokens rather than hardcoded hex, and dismisses
   on Escape and backdrop. Correct only what diverges.
6. **R4** — rewrite §5 of `docs/design/board-ui-layout-and-global-agent-bar.md` with the three real
   token sets (`@theme`, `[data-theme="light"]`, and the `.task-kanban` / `.inbox` scoped ladder),
   each labeled with its selector. Grep the whole doc for `#161922` and `#252936` to confirm neither
   survives.
7. **R5** — call `mcp__open-design__get_active_context`; if an A7 project is pinned, compare the
   shell against it, otherwise state in `## Solution` that the comparison ran against `DESIGN.md`
   alone. Inspect both themes for the surfaces 0773/0774 added: rail, footer, tooltips, agent dock,
   agent bar, settings modal. Every surface gets one labeled verdict.
8. **R6 / verify** — from inside the workspace: `cd apps/web && bun test tests`. Then repo-root
   `bun run autofix && bun run spur-check`. A repo-root single-file run is scored against the
   whole-repo coverage denominator and exits 1 even on a passing test — always run the workspace form.
9. **Record** — write `## Solution` as the verification table: surface · theme · verdict · reason.
   This is R5's deliverable, not a postscript.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/A7_spur-board-layout-optimization-and-global-orchestrator-agent-interface.md` (scenarios R4, R6)
- Design doc: `docs/design/board-ui-layout-and-global-agent-bar.md` — §5 is corrected by this task (R4)
- UI SSOT: root `DESIGN.md` — surface ladder, 4px base, single accent, touch targets; its breakpoint/CTA specs are marketing-page scope (see Q&A)
- Depends on: task 0773 (sidebar footer, `SettingsModal.tsx`, module rename/reorder), task 0774 (`GlobalAgentBar` mounted from `BoardLayout`)
- Dependents: none — terminal task of A7
- Scoped-token decisions this task must not undo: `apps/web/src/styles/global.css:64-77` (0420 R6, `.task-kanban`), `:118-125` (0422 R13, `.inbox`)
- Source surfaces: `apps/web/src/styles/board-layout.css`, `apps/web/src/components/BoardLayout.tsx`,
  `apps/web/src/components/MainWorkspace.tsx`, `apps/web/src/components/LeftSidebar.tsx`,
  `apps/web/src/components/RightPanel.tsx`, `apps/web/src/components/ui/Modal.tsx`,
  `apps/web/tests/components/BoardLayout.test.tsx`
### History
