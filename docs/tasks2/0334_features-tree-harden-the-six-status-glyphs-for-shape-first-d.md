---
template: feature-impl
schema_version: 1
name: "Features tree: harden the six status glyphs for shape-first distinguishability"
description: ""
status: done
type: task
profile: standard
feature_id: F822
parent_wbs: null
priority: P2
tags: ["web", "features", "a11y", "design"]
dependencies: []
created_at: "2026-07-26T00:26:23.958Z"
updated_at: "2026-07-28T00:33:30.273Z"
---

## 0334. Features tree: harden the six status glyphs for shape-first distinguishability

### Background

Removing the text label promotes glyph shape and color from decoration to the sole information channel, and the current glyphs are not ready for that load: four of the six statuses share a circular silhouette — backlog (dashed ring), active (filled disc), done (ring + check), cancelled (ring + ✕). Only verifying (eye) and blocked (triangle) break the ring. With the label gone, color does most of the discriminating, which fails WCAG 1.4.1 (use of color). ADR-034 (3) requires glyphs stay distinguishable by shape in greyscale. Design: docs/design/feature-tree-status-affordance.md §4.

### Requirements
R1. Redraw the glyph paths in `apps/web/src/modules/features/status-icons.tsx` so all six canonical
    statuses are mutually distinguishable at 14px with color removed. The specific drawing is not
    prescribed — the outcome is the requirement.

R2. Break up the ring family: give `cancelled` and `done` distinct outer contours rather than a
    shared ring, and separate `backlog`'s dashed ring from `active`'s filled disc by more than fill
    alone. Today four of six statuses share a circular silhouette.

R3. Leave `verifying` (eye) and `blocked` (triangle) as-is — they already read distinctly.

R4. Verify by rendering all six at 14px in greyscale and checking every pair, not only adjacent ones.
    Record the verification evidence on the task.

R5. Do not reintroduce a text label to compensate — shape must carry the meaning (WCAG 1.4.1,
    ADR-034 (3)).

Satisfies feature AC scenario R6 — see this task's Acceptance Criteria section.
### Acceptance Criteria
```gherkin
Feature: Features tree status affordance (R2) — task 0334

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R6 — The six glyphs are distinguishable by shape without color
    Given the six canonical status glyphs are rendered at 14 pixels
    When color is removed from all six
    Then each glyph's silhouette differs from the other five
    And no two statuses are distinguished by fill color alone

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Redraw four of the six glyphs in `status-icons.tsx` so every status owns a distinct
silhouette at 14px with color removed; keep `verifying` (eye) and `blocked` (triangle) untouched
(R3). ViewBox stays `0 0 16 16`; existing stroke conventions (`strokeWidth` 1.75, round caps/joins)
are preserved.

| Status | Current silhouette | New silhouette | Rationale |
|---|---|---|---|
| backlog | dashed ring | **dashed rounded-square outline** | Breaks the ring family; reads as "empty container / not started" |
| active | filled disc | filled disc (unchanged) | Now separated from backlog by outer contour (circle vs square), not fill alone (R2) |
| verifying | eye | eye (unchanged, R3) | Already distinct |
| blocked | triangle | triangle (unchanged, R3) | Already distinct |
| done | ring + check | **standalone bold check** (no enclosing ring) | The check itself is the silhouette; distinct from every other glyph |
| cancelled | ring + ✕ | **✕ inside octagon outline** | Stop-sign contour; distinct from done's check and from any ring |

Resulting set: dashed square / filled disc / eye / triangle / check / octagon-with-✕ — six mutually
distinct outer contours (R1, R2).

**Verification (R4).** Render all six at 14px forced to a single color (greyscale) and compare
**every pair** — 15 pairs, not only adjacents. Capture the render (screenshot or DOM capture) and
record the pairwise result as evidence in the task's Testing section. Add a unit-level guard
asserting each status maps to distinct SVG markup (a proxy that prevents accidental path
deduplication; the visual claim is the manual matrix, not the test).

**Invariants**

- No text label reintroduced to compensate — shape carries the meaning (WCAG 1.4.1, ADR-034 (3), R5).
- Accessible names and color classes from 0332/0335 untouched — this task changes only `<path>` /
  shape data inside each existing `<svg>`.
- Icon component contract (`className`, `ariaLabel` props) unchanged.

**Impacted surfaces:** `status-icons.tsx` glyph paths only; verification evidence on the task file.
### Plan
- [x] 1. Redraw `backlog` → dashed rounded-square outline (breaks the ring family).
- [x] 2. Redraw `done` → standalone bold check, no enclosing ring (strokeWidth ~2, round caps).
- [x] 3. Redraw `cancelled` → ✕ inside an octagon outline.
- [x] 4. Leave `verifying` (eye) and `blocked` (triangle) as-is; keep `active` filled disc.
- [x] 5. Render all six glyphs at 14px forced to one color; verify all 15 pairs are
  shape-distinguishable; capture the render and record the pairwise matrix in Testing.
- [x] 6. Add a unit test asserting distinct SVG markup per status; run apps/web tests +
  `bun run lint`.
### Solution
Redrawn three of the six glyph paths in `apps/web/src/modules/features/status-icons.tsx` so every canonical status owns a distinct silhouette; viewBox, component contract (`className`/`ariaLabel`), labels, and color classes untouched.

- `status-icons.tsx:33` — backlog: dashed ring (`<circle strokeDasharray>`) → **dashed rounded-square outline** (`<rect x="3" y="3" width="10" height="10" rx="2.5" strokeDasharray="2 2">`). Breaks the ring family; separated from `active`'s filled disc by outer contour, not fill alone (R2).
- `status-icons.tsx:101-115` — done: ring + check → **standalone bold check** (`<path d="M3.5 8.5l3.5 3.5 5.5-7">`, `strokeWidth` 1.75→2, round caps/joins). The check itself is the silhouette (R2).
- `status-icons.tsx:135-136` — cancelled: ring + ✕ → **✕ inside octagon outline** (`<path d="M5.5 2.5h5l3 3v5l-3 3h-5l-3-3v-5l3-3z">` + inner ✕). Stop-sign contour, distinct from done's open check and from any ring (R2).
- `active` (filled disc), `verifying` (eye), `blocked` (triangle) unchanged per R3/R4-design.
- `tests/modules/features/components.test.tsx` — added `every canonical status maps to distinct shape markup` guard to the existing `FeatureStatusIcon` describe block: renders all six via `FeatureStatusIcon` and asserts pairwise-distinct inner SVG markup (proxy against accidental path deduplication).

Resulting set: dashed square / filled disc / eye / triangle / check / octagon-with-✕ — six mutually distinct outer contours (R1, R2). No text label reintroduced (R5).
### Testing
**Unit / suite (fresh this verify run, 2026-07-26):**
- `cd apps/web && bun test tests/modules/features/components.test.tsx` → 27 pass / 0 fail / 143 expect() calls. Distinct-markup guard (`components.test.tsx:329`) passes.
- `cd apps/web && bun test tests/` → 518 pass / 0 fail / 1615 expect() calls across 32 files.
- `cd apps/web && bunx tsc --noEmit` → exit 0.
- `bunx biome check src/modules/features/status-icons.tsx tests/modules/features/components.test.tsx` → clean.
- `spur task check 0334 --strict-core --json` → `pass: true`, 0 findings (after Review L3 P1–P4 table authored — see Review).
- Pre-existing happy-dom `act()` warning from a FeaturesShell SSE test remains; unchanged, out of scope.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Six mutually distinct silhouettes re-read at `status-icons.tsx:35` (dashed rounded-square), `:51` (filled disc), `:69-70` (eye), `:90-92` (triangle), `:112` (standalone check), `:132-133` (octagon + ✕); guard `components.test.tsx:329` (27 pass, fresh this run) |
| R2 | MET | Ring family broken — `git diff` shape-element isolation (fresh this run): backlog circle→rect, done ring+check→standalone check, cancelled ring+✕→octagon+✕; zero circular-outline glyphs remain; backlog/active separated by outer contour, not fill |
| R3 | MET | Same diff isolation: zero shape-element changes in the verifying or blocked hunks |
| R4 | MET | Greyscale render re-executed this run (see below): 6/6 glyphs at exactly 14×14 px, single color, 15/15 pairs distinct |
| R5 | MET | No `<text>` in the diff; all six SVGs shape-elements only; `components.test.tsx:190-202` asserts no raw status text in the tree render |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R6 — six glyphs distinguishable by shape without color | MET | test | Guard `components.test.tsx:329` (fresh: 27 pass / 0 fail) + greyscale render command this run: 6× 14×14 px at `#666`, screenshot 4×, 15/15 pairs distinct |

**R4 greyscale render evidence (AC R6) — re-executed fresh this verify run.** All six glyphs
rendered from the real `FEATURE_STATUS_MAP` components via `renderToStaticMarkup`, forced to a
single color (`#666`), opened in headless Chromium, each confirmed exactly 14×14 px via
`getBoundingClientRect` (backlog/active/verifying/blocked/cancelled/done all 14x14), screenshot
inspected at 4× magnification (`/tmp/glyphs-grey-4x-verify.png`, ephemeral; DOM capture below is
the durable evidence).

DOM capture (single-color render, shape elements only):

| Status | Shape markup | Silhouette |
|---|---|---|
| backlog | `<rect x="3" y="3" width="10" height="10" rx="2.5" stroke-dasharray="2 2">` | dashed rounded-square outline |
| active | `<circle cx="8" cy="8" r="4.5">` (filled) | solid disc |
| verifying | eye `<path>` + iris `<circle r="2">` | eye |
| blocked | triangle `<path>` + `!` | triangle |
| done | `<path d="M3.5 8.5l3.5 3.5 5.5-7">` (stroke 2) | standalone check |
| cancelled | octagon `<path>` + inner ✕ | octagon with ✕ |

Pairwise matrix — all 15 pairs distinguishable by shape with color removed (✓ = distinct silhouette):

| | active | verifying | blocked | done | cancelled |
|---|---|---|---|---|---|
| backlog | ✓ square vs disc | ✓ square vs eye | ✓ square vs triangle | ✓ square vs check | ✓ square vs octagon |
| active | | ✓ disc vs eye | ✓ disc vs triangle | ✓ disc vs check | ✓ disc vs octagon |
| verifying | | | ✓ eye vs triangle | ✓ eye vs check | ✓ eye vs octagon |
| blocked | | | | ✓ triangle vs check | ✓ triangle vs octagon |
| done | | | | | ✓ open check vs closed octagon |

15/15 pairs distinct; no pair relies on fill color alone (backlog/active differ by outer contour).
Ring family eliminated: zero circular-outline glyphs remain.

**Design conformance:** 8/8 claims DONE — backlog dashed rounded-square (`:35`), active disc
unchanged (`:51`), verifying/blocked untouched (diff isolation), done standalone bold check
strokeWidth 2 (`:112`), cancelled octagon + ✕ (`:132-133`), viewBox/stroke conventions preserved,
distinct-markup guard added (`components.test.tsx:329`), R4 matrix recorded. No CHANGED/NOT-DONE
claims; no scope creep (diff matches Design "Impacted surfaces").

**Coverage:** N/A per-repo gate — React `.tsx` sources are excluded from the per-file coverage
threshold (`bunfig.toml`); behavior is guarded by the new distinct-markup test plus the existing
6-status render assertions in `components.test.tsx`.
### Review
Reviewed 2026-07-26 via `/sp-dev-review 0334 --auto` — three dimensions (functional traceability +
SECUA + architectural depth). Diff scope: working tree (task file uncommitted); scoped to 0334's
declared delta — glyph paths in `apps/web/src/modules/features/status-icons.tsx` + the
distinct-markup guard in `apps/web/tests/modules/features/components.test.tsx`. The working tree
also carries sibling-task changes (0332 aria names, 0333 leading slot, 0336 tooltip); those were
excluded from this review except where the diff hunks interleave (aria-label attrs in
status-icons.tsx belong to 0332).

P1–P4 priority table authored 2026-07-26 during `/sp-dev-verify 0334 --auto --next` to satisfy
Review L3 (`L3.review-priority-table`); findings unchanged, re-keyed to the priority scale.

**P1–P4 findings**

| Priority | Finding | File | Recommendation |
|----------|---------|------|----------------|
| P3 | Solution section line anchors stale by ~2 lines — backlog rect cited `:33` (actual `:35`), done cited `101-115` (path at `:112`), cancelled cited `135-136` (actual `:132-133`); no code impact | `docs/tasks2/0334_features-tree-harden-the-six-status-glyphs-for-shape-first-d.md` (Solution) | Correct anchors on the next Solution touch; review evidence below already uses the corrected anchors |
| P4 | Repeated `<svg>` boilerplate across six Icon components — className template, viewBox, `role="img"`, aria-label plumbing (~4 lines × 7 sites) | `apps/web/src/modules/features/status-icons.tsx:23-137` | Advisory: extract an internal `IconSvg` wrapper with an attr-override surface (per-glyph attrs genuinely diverge, so the win is real but small) |

No P1–P2 findings — clean review. P3 is doc hygiene; P4 is advisory/architectural. Neither blocks
the gate.

**Functional Traceability** (all line anchors re-read this run)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Six mutually distinct silhouettes: `status-icons.tsx:35` (dashed rounded-square), `:51` (filled disc), `:69-70` (eye), `:90-92` (triangle), `:112` (standalone check), `:132-133` (octagon + ✕); executable guard `components.test.tsx:329` asserts pairwise-distinct inner markup |
| R2 | MET | Ring family broken: done = standalone check (`:112`, no enclosing ring), cancelled = octagon contour (`:132`), backlog square (`:35`) vs active disc (`:51`) — separated by outer contour, not fill. `git diff` shape-element isolation confirms no circular-outline glyph remains |
| R3 | MET | Diff isolation (`git diff` filtered to `<path>/<circle>/<rect>` lines): zero shape-element changes in the verifying or blocked hunks; only backlog/done/cancelled paths touched |
| R4 | MET | Testing section records the 15/15 pairwise greyscale matrix + per-glyph DOM capture rendered from the real `FeatureStatusIcon` components at 14px forced to `#666` (headless Chromium, size confirmed via `getBoundingClientRect`). DOM capture is the durable evidence; screenshot was ephemeral |
| R5 | MET | All six SVGs contain shape elements only — no `<text>`; `components.test.tsx:190-202` asserts no raw status text in the tree render |
| AC R6 | MET | Executable: `components.test.tsx:329` guard (fresh this run: `bun test tests/modules/features/components.test.tsx` → 27 pass / 0 fail / 143 expects). Static: 15-pair matrix in Testing. Visual distinguishability is inherently human-judged; the recorded matrix is the evidence per the task's own design |

**Functional Verdict: PASS**

**SECUA Review** (`--focus all`, delta = glyph paths + guard test)

- **S:** no findings — static SVG markup, no user input interpolated into paths or attributes.
- **E:** no findings — inline SVGs, constant-size markup; no allocation or render-cost change of note.
- **C:** no findings — paths valid (render through happy-dom tests + headless Chromium capture); octagon path is a closed regular octagon; done `strokeWidth` 1.75→2 matches the approved design table.
- **U:** no findings — component contract (`className`/`ariaLabel`) unchanged; accessible names thread through exactly as 0332 established; fallback icon for unknown statuses intact (`status-icons.tsx:155`).
- **A:** see the P4 architecture candidate in the priority table above.

Fresh checks this run: `bun test tests/modules/features/components.test.tsx` → 27 pass / 0 fail;
`bunx tsc --noEmit` (apps/web) → exit 0; `bunx biome check` on both changed files → clean.

**Architecture (sp-code-improvement, five lenses over the delta)**

The P4 candidate above is the only signal: shallow-module-adjacent declarative duplication in
`status-icons.tsx:23-137` (+ fallback `:154-156`) — seven near-identical `<svg>` wrappers.
Deepening proposal: internal presentational `IconSvg` wrapper absorbing className/viewBox/role/
aria-label. Challenge: per-glyph attributes genuinely diverge (fill vs stroke models,
`strokeWidth` 1.75 vs 2, `strokeLinecap`/`strokeLinejoin` on only some glyphs), so the wrapper
needs an attr-override surface nearly as wide as the boilerplate it replaces. Defense: partial —
absorbs ~4 lines × 7 sites while leaving per-glyph svg attrs as a rest-prop.

Other lenses — tight coupling: none (domain vocabulary seam respected via
`@gobing-ai/spur-domain` re-export, ADR-034). Wrong seam: none (icon data belongs with the web
module). Weak locality: none. Poor test surface: none (guard tests through the public
`FeatureStatusIcon`, matching file conventions).

**Disposition:** Functional PASS; SECUA clean; one P3 doc-hygiene finding + one P4 advisory
architecture candidate (operator's call, not a gate blocker). No text label reintroduced;
WCAG 1.4.1 / ADR-034 (3) shape-first requirement satisfied with the recorded greyscale matrix.
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T19:01:42.964Z todo → wip (system)
- 2026-07-26T19:03:32.956Z wip → testing (system)
- 2026-07-26T19:33:02.946Z testing → done (system)
