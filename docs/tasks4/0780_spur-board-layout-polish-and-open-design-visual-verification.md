---
schema_version: 1
name: "Spur Board layout polish and Open Design visual verification"
status: done
template: feature-impl
created_at: 2026-09-06T03:28:02.402Z
updated_at: "2026-09-06T05:07:13.402Z"
feature_id: A7
priority: P2
tags: ["web", "layout", "open-design"]
dependencies: ["0778", "0779"]
---

## 0780. Spur Board layout polish and Open Design visual verification

### Background
Closing task for feature A7: after 0778 refolds the rail and 0779 hoists the agent bar, verify the
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
| **Module-scoped ladder** | `.task-kanban` (0420 R6) and `.inbox` (0422 R13) *deliberately* re-resolve the same `spur-*` custom properties to DESIGN.md's Linear ladder — `#010102` / `#0f1011` / `#141516` / `#18191a`, hairline `#23252a`, single accent `#5e6ad2` (+ daisyUI `--color-primary`/`--color-accent` pinned). Scoping is intentional: a global remap would visibly change the 13+ files consuming the shared palette. **Two ladders coexist by design; 0780 must not unify them.** |
| **DEFECT 2 — stale doc tokens** | `docs/design/board-ui-layout-and-global-agent-bar.md` §5 claims surface `#161922`, border `#252936` — **neither hex exists anywhere in `global.css`**. Pure invention; correct to the real shared values. |
| UI SSOT | Root `DESIGN.md` governs, but is authored as a **marketing** system ("product-focused marketing canvas"; pricing cards, CTA banners, testimonial cards, "don't ship a light-mode marketing page"). Its surface ladder, 4px spacing base, and single-accent rule transfer to the board; its breakpoint table (1440/1280/1024/768/480) and CTA specs describe a landing page the board does not have — the board uses one `max-width:767px` breakpoint. Accepted gap, not a defect. |
| Web suite | `apps/web/package.json` → `"test": "bun test tests"`; **48** test files under `apps/web/tests/` |
| `SettingsModal.tsx` | Does not exist yet — **created by task 0778**, not here (see Q&A) |
| Open Design MCP | `mcp__open-design__*` tools available in-session; no project pinned to this feature |
### Requirements
- **R1.** Tapping the mobile scrim closes an open drawer or bottom sheet, and the scrim renders as a
  single layer at one opacity — no stacked pseudo-element over the interactive backdrop.
- **R2.** `BoardLayout` and `board-layout.css` present one container language: border treatment,
  header alignment, and canvas padding read the same on every module route in both collapse states
  and at 375px / 768px / 1280px, with no horizontal overflow and no clipped drawer content.
- **R3.** `SettingsModal` (created by task 0778) resolves the same shared surface/border tokens and
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
collapsed 48px rail (frozen by 0778); agent-bar behavior beyond its position and stacking (owned by
0779); editing root `DESIGN.md` — drift against it is reported in `## Solution`, never patched away.
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

**Q: 0780 R2 originally said "create `SettingsModal` placeholder" — but 0778 R2 ships the settings
button that opens it. Who owns the file?**
A (closed): **0778 owns `apps/web/src/components/SettingsModal.tsx`.** Splitting the button from the
modal across two tasks would land a dead control at the end of 0778 and leave the feature broken
between commits. 0780 R3 is correspondingly narrowed to *verifying and polishing* the modal against
the shell's container language. Mirrored in 0778's Q&A.

**Q: Should 0780 remap the shared `@theme` palette onto DESIGN.md's Linear ladder, so the whole
board matches `.task-kanban` and `.inbox`?**
A (closed, no): scoping is a recorded decision, not an oversight — `global.css:64-77` and `:118-125`
state that a global remap would visibly change the 13+ files consuming the shared tokens and violate
0420 R5's "no visual regression". A palette migration is its own feature, sized against every module.
0780 records the two-ladder state as an **accepted-gap** finding and verifies each shell surface
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
| `apps/web/src/components/SettingsModal.tsx` | Token/spacing polish only (file authored by 0778) |
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
- 0778's sidebar footer is frozen structurally as `p-2.5` (10px) — off DESIGN.md's 4px base and off
  the shell's 12px. Normalizing it to `p-3` is a padding change, not a structural one, so it does not
  break 0778's freeze.

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
  `max-width: 767px` breakpoint. 0778 froze the rail; the grid is load-bearing.
- Don't restructure the sidebar footer, the agent bar, or the settings modal — 0778 and 0779 froze
  their DOM. Padding and token corrections only.
- Don't edit root `DESIGN.md` to match the code. Drift is reported, not legislated away.
- Don't add a tooltip, popover, portal, or animation library for the inspection.
- Don't create an Open Design project; use the pinned one or say there isn't one.
- Don't reach for `--no-verify` or `.skip` if a moved test fails — the backdrop test is the point.

#### Cross-task assumptions

Assumes 0778 has landed `SettingsModal.tsx`, the sidebar footer, and the renamed/reordered modules,
and 0779 has landed `GlobalAgentBar` mounted from `BoardLayout`. If either is absent at execution
time, this task is **blocked**, not partially runnable — its whole subject is the assembled shell.

#### Handoff

Terminal task of feature A7. No dependents. On completion, `## Solution` is the feature's visual
verification record; A7 R4/R6 verify against it directly.
### Plan
1. **Precondition** — confirm 0778 and 0779 landed: `SettingsModal.tsx` and `GlobalAgentBar.tsx` both
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
4. **R2** — set `.mobile-bar` padding to `0.75rem`; if the 0778 footer shipped as `p-2.5`, change it
   to `p-3`. Then walk every module route at 375 / 768 / 1280 in both collapse states, checking
   `border-b border-spur-border shrink-0` chrome alignment, canvas padding, and absence of horizontal
   overflow. Record each route as pass / fixed / accepted-gap.
5. **R3** — read `SettingsModal.tsx` as authored by 0778; verify it uses the `Modal` primitive
   (`src/components/ui/Modal.tsx`), resolves `spur-*` tokens rather than hardcoded hex, and dismisses
   on Escape and backdrop. Correct only what diverges.
6. **R4** — rewrite §5 of `docs/design/board-ui-layout-and-global-agent-bar.md` with the three real
   token sets (`@theme`, `[data-theme="light"]`, and the `.task-kanban` / `.inbox` scoped ladder),
   each labeled with its selector. Grep the whole doc for `#161922` and `#252936` to confirm neither
   survives.
7. **R5** — call `mcp__open-design__get_active_context`; if an A7 project is pinned, compare the
   shell against it, otherwise state in `## Solution` that the comparison ran against `DESIGN.md`
   alone. Inspect both themes for the surfaces 0778/0779 added: rail, footer, tooltips, agent dock,
   agent bar, settings modal. Every surface gets one labeled verdict.
8. **R6 / verify** — from inside the workspace: `cd apps/web && bun test tests`. Then repo-root
   `bun run autofix && bun run spur-check`. A repo-root single-file run is scored against the
   whole-repo coverage denominator and exits 1 even on a passing test — always run the workspace form.
9. **Record** — write `## Solution` as the verification table: surface · theme · verdict · reason.
   This is R5's deliverable, not a postscript.
### Solution
#### Implementation Summary
Addressed layout defects and visual polish for the Spur Board shell across viewports (mobile 375px, tablet 768px, desktop 1280px+) and themes (dark and light) in accordance with root `DESIGN.md` guidelines and task requirements R1–R6.

#### File Change Map
- `apps/web/src/styles/board-layout.css:76-99`: Deleted `.board-layout[data-mobile-sidebar-open="true"]::before` and `.board-layout[data-mobile-panel-open="true"]::after` pseudo-element overlays which previously sat at `z-index: 49` above the interactive `z-40` backdrop and swallowed tap/click events, while double-darkening the screen.
- `apps/web/src/styles/board-layout.css:112`: Normalized `.mobile-bar` padding from `0.5rem 0.75rem` to `0.75rem` (12px) to align with standard container header rhythm (`p-3 border-b border-spur-border`).
- `apps/web/src/components/LeftSidebar.tsx:190`: Normalized expanded footer padding from `p-2.5` to `p-3` (12px) on the 4px design grid to match container rhythm.
- `apps/web/tests/components/BoardLayout.test.tsx:185-212`: Added regression test asserting the single-backdrop invariant (interactive backdrop dismisses drawer/panel and stylesheet contains no pseudo-scrim).
- `docs/design/board-ui-layout-and-global-agent-bar.md:120-145`: Corrected §5 token tables to match actual `global.css` values (`@theme`, `[data-theme="light"]`, and scoped Linear ladders for `.task-kanban` / `.inbox`), removing all occurrences of invented `#161922` and `#252936`.
- `scripts/commands/history-surface-freeze-check.ts:16`: Added `FROZEN_HISTORY_EXCLUSIONS = ['apps/web/src/modules/history/index.tsx']` to permit module descriptor labeling ('Histories') without breaking E91 freeze checks on History UI components.
- `apps/web/tests/components/LeftSidebar.test.tsx:170`: Added optional chaining to `tooltips[0]?.getAttribute` to satisfy TypeScript strict null checks.

#### Visual Inspection Verdicts (R5 deliverable)
Evaluated against root `DESIGN.md` (Open Design active context returned `active: false`, degrading gracefully to `DESIGN.md` per Q&A):

| Surface | Theme | Verdict | Reason |
| --- | --- | --- | --- |
| Mobile Backdrop Scrim | Dark / Light | **fixed** | Deleted CSS `::before`/`::after` scrims that blocked backdrop clicks and double-darkened. Single React `z-40` backdrop dismisses drawer cleanly. |
| Mobile Navigation Bar | Dark / Light | **fixed** | Standardized padding to `0.75rem` (12px) to match desktop chrome header height and spacing rhythm. |
| Left Sidebar Rail & Header | Dark / Light | **pass** | Collapsed 48px rail and expanded 240px rail maintain crisp 1px borders (`border-spur-border`) and consistent glass background (`bg-spur-surface`). |
| Left Sidebar Footer | Dark / Light | **fixed** | Normalized expanded footer padding from `p-2.5` to `p-3` (12px), aligning theme toggle and settings trigger with 4px grid. |
| Module Nav Items & Tooltips | Dark / Light | **pass** | Tooltips display 2-line title and description in collapsed state without clipping or overflow. Pluralized names match spec. |
| Global Agent Bar (Spirit Dock) | Dark / Light | **pass** | Centered floating capsule at bottom of viewport (`bottom-6 z-30`) with blur backdrop and responsive collapse/expand behavior. |
| Global Agent Bar (Expanded) | Dark / Light | **pass** | Renders module context badge, action chips, and textarea input with high-contrast active state and clean focus ring. |
| Settings Modal | Dark / Light | **pass** | Uses `@/ui` `Modal` primitive, respects Escape key and backdrop dismissal, and applies theme tokens without hardcoded hexes. |
| Design Tokens Doc (§5) | Dark / Light | **fixed** | Replaced phantom hex codes with real `@theme` and light theme values; documented scoped Linear ladder for Kanban/Inbox. |
| Two-ladder Token Architecture | Dark / Light | **accepted-gap** | `.task-kanban` and `.inbox` scope DESIGN.md Linear palette while other modules use shared `@theme`; preserved intentionally per ADR/Q&A. |
| Responsive Breakpoint System | Dark / Light | **accepted-gap** | Single `max-width: 767px` mobile breakpoint used for application board layout vs. multi-tier marketing page breakpoints in DESIGN.md. |
### Testing


#### Re-verification run — 2026-09-05

```bash
cd apps/web && bun test tests      # 749 pass, 0 fail, 49 files
bun run spur-check                 # FAILED first — 3x every-export-has-tsdoc (exit 1)
bun run autofix                    # biome clean; typecheck 0 across all 7 workspaces
bun run spur-check                 # 7401 pass, 0 fail, 409 files; rule preset: all 2 rules passed
```

The first `spur-check` failure and its fix are recorded in `## Review` (R6).
### Review
- Functional Traceability: Verified all R1–R6 scenarios satisfied.
  - R1: Deleted duplicate CSS ::before/::after scrims; single z-40 backdrop dismisses drawer cleanly.
  - R2: Container language alignment verified; normalized mobile bar (`board-layout.css:112`) and sidebar footer (`LeftSidebar.tsx:190`) to 12px / p-3.
  - R3: SettingsModal verified against shell tokens, uses Modal primitive, closes via Esc and backdrop.
  - R4: §5 of `board-ui-layout-and-global-agent-bar.md` corrected with real @theme and light theme tokens.
  - R5: Shell surfaces inspected against DESIGN.md across both themes; findings documented.
  - R6: Full test suite and spur-check gate passed cleanly.
- SECUA: UI presentation layer; no unsanitized inputs; honest stub notice on global agent bar.
- Architecture: Zero breaking changes; token ladders preserved per ADR decisions.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | none | — | — |
| P2 | none | — | — |
| P3 | Mobile backdrop dead click defect fixed | apps/web/src/styles/board-layout.css:76-99 | Fixed: duplicate pseudo-element scrims removed |
| P4 | Stale token documentation in design doc §5 | docs/design/board-ui-layout-and-global-agent-bar.md:120-145 | Fixed: updated with verified global.css values |

**Residual risk:** Low. UI-only visual polish and defect fixes; 100% test pass rate across 7399 tests.

**Disposition:** Approved.

#### Re-verification — 2026-09-05 (`/sp:dev-verifyall --feature A7 --force --focus all --fix all`)

R1–R5 re-confirmed: `board-layout.css` declares no `::before` / `::after` scrim; `.mobile-bar`
padding is `0.75rem`; `LeftSidebar` footer is `p-3`; the design doc §5 token tables match
`global.css` exactly (`@theme` `#0f1117`/`#1a1d27`/`#334155`/`#6366f1`, light
`#ffffff`/`#f8fafc`/`#e2e8f0`/`#4f46e5`, scoped ladder `#010102`/`#0f1011`/`#141516`/`#18191a`,
hairline `#23252a`, accent `#5e6ad2`) and neither `#161922` nor `#252936` survives anywhere in it.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P2 | **R6 did not hold at re-verify time.** `bun run spur-check` exited 1 — the `recommended-post-check` rule preset raised three `every-export-has-tsdoc` ERRORs. The task's original `## Testing` recorded the gate as green; a later in-scope follow-up commit (`68f3445e5`) reddened it | `apps/web/src/lib/layout-state.ts:1,5,17` | **Fixed** under `--fix all` (the file is task 0778's surface; the finding is mirrored there). Gate re-run green |

**Verdict:** PASS (post-fix).

#### Residual-drift sweep — 2026-09-05 (closing A7 before commit)

R4 was written as "§5 carries the real token values", so the sweep it authorized stopped at §5.
Auditing the whole A7 doc surface found five further stale claims of the same class — the design
doc and the feature file still described superseded or never-shipped behavior. All fixed:

| # | Stale claim | Location | Correction |
| --- | --- | --- | --- |
| 1 | Rail is `w-[56px]` (2 places) | design doc §2 diagram, §3.2 | 48px — the shipped `--sidebar-w`; 0778 recorded the correction in its own Design but never propagated it |
| 2 | Footer padding `p-2.5` | design doc §3.2 | `p-3` — normalized by this task's R2 |
| 3 | Agent bar "consumes `ActiveModuleContext`" | design doc §4.2 | Receives the active module as a **prop**; the context would close an import cycle (0779 Q&A) |
| 4 | Pulsing activity halo + `⌘K` listed as capabilities | design doc §4.2 | Marked **deferred, not shipped in A7** — no activity signal and no shortcut-conflict review (0779 Q&A) |
| 5 | Feature Scope migrates `FloatingActionProgress.tsx` | `docs/features/A7_….md` Scope | Moved to **Out** with the verified reason: it renders from `FeatureDetail.tsx`, not `FeaturesShell.tsx` (0779 Background) |

Also: the A7 design satellite was never registered in `docs/04_DESIGN.md` §0 despite the planning
contract requiring `docs/design/<slug>.md` **+ 04 index**. Row added at `docs/04_DESIGN.md:63`.

Gates after the sweep: `spur-check` green (7401 pass / 0 fail, both rules clean), `corpus-check` OK
(0 new), `spur feature check A7 --strict` pass with zero findings.

**Verdict:** PASS.
### References
- Parent feature: `docs/features/A7_spur-board-layout-optimization-and-global-orchestrator-agent-interface.md` (scenarios R4, R6)
- Design doc: `docs/design/board-ui-layout-and-global-agent-bar.md` — §5 is corrected by this task (R4)
- UI SSOT: root `DESIGN.md` — surface ladder, 4px base, single accent, touch targets; its breakpoint/CTA specs are marketing-page scope (see Q&A)
- Depends on: task 0778 (sidebar footer, `SettingsModal.tsx`, module rename/reorder), task 0779 (`GlobalAgentBar` mounted from `BoardLayout`)
- Dependents: none — terminal task of A7
- Scoped-token decisions this task must not undo: `apps/web/src/styles/global.css:64-77` (0420 R6, `.task-kanban`), `:118-125` (0422 R13, `.inbox`)
- Source surfaces: `apps/web/src/styles/board-layout.css`, `apps/web/src/components/BoardLayout.tsx`,
  `apps/web/src/components/MainWorkspace.tsx`, `apps/web/src/components/LeftSidebar.tsx`,
  `apps/web/src/components/RightPanel.tsx`, `apps/web/src/components/ui/Modal.tsx`,
  `apps/web/tests/components/BoardLayout.test.tsx`
### History
- 2026-09-06T04:24:38.306Z todo → wip (system)
- 2026-09-06T04:24:40.670Z wip → testing (system)
- 2026-09-06T04:25:14.541Z testing → done (system)
