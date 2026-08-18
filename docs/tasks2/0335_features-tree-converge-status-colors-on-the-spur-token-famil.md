---
template: feature-impl
schema_version: 1
name: "Features tree: converge status colors on the Spur token family with light-theme values"
description: ""
status: done
type: task
profile: standard
feature_id: F822
parent_wbs: null
priority: P2
tags: ["web", "features", "a11y", "tokens"]
dependencies: []
created_at: "2026-07-26T00:26:23.967Z"
updated_at: "2026-08-18T04:42:47.962Z"
done_forced: "true"
done_reason: "Operator accepted the designed R4 hard-stop outcome at the pipeline approve gate (2026-07-26, runall batch R2): cancelled-glyph light contrast 2.30:1 < 3:1 blocks the token swap; AC R10 carried by follow-up task 0338. Task requirements R1-R4 all MET per verify; verdict PARTIAL solely on the deferred R10."
---

## 0335. Features tree: converge status colors on the Spur token family with light-theme values

### Background

status-icons.tsx splits its six status colors 4/2 across two token families: backlog, active, verifying, and cancelled use Spur tokens, while blocked uses daisyUI text-error and done uses daisyUI text-success. This orphans --color-spur-error and --color-spur-success (declared at apps/web/src/styles/global.css:16-17 with no consumer) and leaves two families resolving the same semantics. The split is invisible while a text label carries the meaning and becomes a contrast risk the moment the label is removed. ADR-034 (2) resolves it in favour of the Spur family on Spur-token surfaces — but gates the swap: the [data-theme="light"] block at global.css:29-36 overrides only bg/surface/accent/accent-hover/text/text-muted/border, so the semantic tokens are theme-invariant and tuned for the dark canvas (#0f1117), whereas the daisyUI classes they would replace re-resolve per theme. Swapping without the light-theme work would trade a token inconsistency for a light-mode contrast regression. Operator confirmed this prerequisite is in scope. Design: docs/design/feature-tree-status-affordance.md §5.

### Requirements
Work these in order. The ordering is a requirement, not a suggestion — ADR-034 (2) gates the class
swap on the light-theme work.

R1. Add light-theme values for `--color-spur-success`, `--color-spur-warning`, and `--color-spur-error`
    to the `[data-theme="light"]` block in `apps/web/src/styles/global.css`. Choose them for the light
    canvas; do not inherit the dark-tuned `@theme` values. Today that block overrides only
    bg/surface/accent/accent-hover/text/text-muted/border, leaving the semantic tokens theme-invariant.

R2. Measure the contrast ratio of all six status glyphs against both the dark (`#0f1117`) and the
    light (`#ffffff`) panel background, and confirm each is at least 3:1 (WCAG 1.4.11, non-text
    graphical objects). Record the measured ratios as evidence on the task.

R3. Only once both canvases pass, move `blocked` from `text-error` to `text-spur-error` and `done`
    from `text-success` to `text-spur-success` in `status-icons.tsx`, so all six statuses resolve
    through one token family and the orphaned tokens at `global.css:16-17` gain a consumer.

R4. If any glyph cannot reach 3:1 on either canvas, stop before R3, leave the current 4/2 split in
    place, and record the blocker. Do not swap blind — that would trade a token inconsistency for a
    light-mode contrast regression.

Satisfies feature AC scenario R10 — see this task's Acceptance Criteria section.
### Acceptance Criteria
```gherkin
Feature: Features tree status affordance (R2) — task 0335

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R10 — Status colors resolve through one token family with sufficient contrast
    Given the tree renders all six canonical statuses
    When the color class of each status indicator is inspected
    Then all six resolve through a single token family
    And each glyph has a contrast ratio of at least 3:1 against the panel background
    And that holds on both the dark and the light theme canvas

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach — order is normative** (ADR-034 (2) gates the class swap on the light-theme work; R4 is a
hard stop):

1. **Light-theme semantic tokens (R1).** Add `--color-spur-success`, `--color-spur-warning`,
   `--color-spur-error` to the `[data-theme="light"]` block in `apps/web/src/styles/global.css`.
   Starting candidates tuned for the white canvas: `#15803d` (success), `#b45309` (warning),
   `#dc2626` (error) — but the measured contrast decides, not the guess.
2. **Contrast measurement (R2).** Compute WCAG relative-luminance contrast
   ($L = 0.2126R + 0.7152G + 0.0722B$ on linearized sRGB; ratio $= \frac{L_1 + 0.05}{L_2 + 0.05}$)
   for all six glyph colors against the dark panel `#0f1117` and the light panel `#ffffff`, via a
   small bun script. `cancelled` is measured with its `opacity-60` blend (effective color =
   0.6 × text-muted + 0.4 × panel bg). All 12 ratios must be ≥ 3:1 (WCAG 1.4.11). Record the table
   in the task's Testing section.
3. **Gated swap (R3, R4).** Only if all 12 ratios pass: move `blocked` from `text-error` to
   `text-spur-error` and `done` from `text-success` to `text-spur-success` in `status-icons.tsx`.
   If any ratio fails: stop before the swap, leave the current 4/2 split, record the blocker.

**Invariants**

- After the swap all six statuses resolve through the Spur token family; the orphaned
  `--color-spur-success` / `--color-spur-error` tokens (`global.css:16-17`) gain consumers.
- Dark-canvas values in `@theme` are unchanged — no dark-mode regression.
- `text-spur-*` utilities resolve from `@theme` tokens under Tailwind v4 (precedent:
  `text-spur-accent`, `text-spur-warning` already in use).

**Impacted surfaces:** `apps/web/src/styles/global.css` (light block), `status-icons.tsx` (two
class strings); measurement script is throwaway evidence, not committed tooling.
### Plan
- [x] 1. Write a bun contrast script computing WCAG ratios for the six glyph colors vs `#0f1117`
  and `#ffffff`; include `cancelled`'s 0.6-opacity blend with the panel background.
- [x] 2. Add `--color-spur-success` / `--color-spur-warning` / `--color-spur-error` to the
  `[data-theme="light"]` block (start `#15803d` / `#b45309` / `#dc2626`; adjust until each passes
  ≥ 3:1 on `#ffffff`).
- [x] 3. Verify the dark-canvas ratios for the existing `@theme` values ≥ 3:1; record all 12 ratios.
- [x] 4. Gate: all 12 ratios ≥ 3:1 → proceed to step 5; otherwise stop, leave the 4/2 split, record
  the blocker (R4).
- 5. **NOT PERFORMED — R4 hard stop fired** (cancelled/light 2.30:1 < 3:1). Swap `blocked` → `text-spur-error` and `done` → `text-spur-success` in `status-icons.tsx`.
- [x] 6. Record the measured ratio table in Testing; run apps/web tests + `bun run lint`.
### Solution
**Outcome: R1 landed; R3 swap blocked by the R4 gate (cancelled glyph on the light canvas at 2.30:1 < 3:1). The 4/2 split stays.**

Change map:

- `apps/web/src/styles/global.css` (`[data-theme="light"]` block) — R1: added light-canvas values
  `--color-spur-success: #15803d`, `--color-spur-warning: #b45309`, `--color-spur-error: #dc2626`.
  The dark-tuned `@theme` values are untouched (no dark-mode regression). This already has one live
  consumer: `verifying` uses `text-spur-warning`, whose light-canvas contrast rises from 2.15:1
  (dark-tuned `#f59e0b` on white) to 5.02:1. The success/error light values are staged for the R3
  swap and stay orphaned until the gate passes.
- `apps/web/src/modules/features/status-icons.tsx` — **unchanged on purpose.** R4 hard stop: the
  measured gate failed (see Testing), so `blocked` keeps `text-error` and `done` keeps
  `text-success`. Swapping blind would have traded a token inconsistency for a light-mode contrast
  regression.

Blocker (R4): `cancelled` (`text-spur-text-muted opacity-60`) blends to `#a2acb9` on the white
panel — 2.30:1, below the WCAG 1.4.11 3:1 floor for non-text graphical objects. All other 11 of 12
ratios pass (4.22:1–8.79:1). The failure is pre-existing, not introduced by R1; it only became
measurable now.

Follow-up options for a future task (out of scope here — R1–R3 name no lever over cancelled):

1. Drop `opacity-60` on the light canvas (e.g. a theme-conditional class) — plain
   `text-spur-text-muted` on light is 4.76:1.
2. Introduce a dedicated `--color-spur-text-faint` token per theme so cancelled stops deriving its
   color from an opacity blend.
3. Darken the light-theme `--color-spur-text-muted` — rejected: would de-legibilize muted body text
   app-wide to fix one glyph.
### Testing
**Verify run — 2026-07-26 (`/sp:dev-verify 0335 --auto --next`, standalone).** All evidence
re-produced this turn; line anchors re-read at the cited lines.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/styles/global.css:39-41` — `--color-spur-success: #15803d`, `--color-spur-warning: #b45309`, `--color-spur-error: #dc2626` inside `[data-theme="light"]` (re-read this run); dark `@theme` values at lines 15-17 untouched |
| R2 | MET | Ratio table below, independently re-computed this run (`bun /tmp/verify-0335-contrast.mjs`) — 12/12 values match the recorded table |
| R3 | MET (conditional complied) | R3 permits the swap only once both canvases pass; they do not (cancelled/light 2.30:1), so the mandated behavior is no swap. Re-read this run: `apps/web/src/modules/features/status-icons.tsx:77` keeps `text-error`, `:99` keeps `text-success` |
| R4 | MET | Gate fired on `cancelled`/light = 2.30:1 < 3:1; stopped before R3; 4/2 split left in place; blocker recorded in Solution with three follow-up levers |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R10: all six statuses through one token family | UNMET (designed R4 outcome) | static-ref | `status-icons.tsx:77,99` — `blocked`/`done` still on daisyUI `text-error`/`text-success`; R4 froze the swap |
| R10: each glyph ≥ 3:1 against panel background | PARTIAL | command | `bun /tmp/verify-0335-contrast.mjs` — 11/12 pass; `cancelled`/light = 2.30:1 |
| R10: holds on both dark and light canvases | PARTIAL | command | Same run — all dark cells pass (3.40:1–8.79:1); light fails only on `cancelled` |

R10 stays unsatisfied — that is the designed R4 outcome, not an implementation miss. The AC needs
a follow-up task that resolves the `cancelled` light-canvas contrast (Solution options 1–2) before
R3 can complete the convergence.

**R2 contrast evidence** — WCAG 1.4.11 ratios ($L = 0.2126R + 0.7152G + 0.0722B$ on linearized
sRGB; ratio $= \frac{L_1+0.05}{L_2+0.05}$). `cancelled` measured with its `opacity-60` blend
(effective color = 0.6 × text-muted + 0.4 × panel bg). Dark panel `#0f1117`, light panel `#ffffff`.

| status | class | dark glyph | dark ratio | light glyph | light ratio | pass? |
|---|---|---|---|---|---|---|
| backlog | text-spur-text-muted | #94a3b8 | 7.36:1 | #64748b | 4.76:1 | PASS |
| active | text-spur-accent | #6366f1 | 4.22:1 | #4f46e5 | 6.29:1 | PASS |
| verifying | text-spur-warning | #f59e0b | 8.79:1 | #b45309 | 5.02:1 | PASS |
| blocked | text-spur-error (staged) | #ef4444 | 5.01:1 | #dc2626 | 4.83:1 | PASS |
| done | text-spur-success (staged) | #22c55e | 8.28:1 | #15803d | 5.02:1 | PASS |
| cancelled | text-spur-text-muted opacity-60 | #5f6978 | 3.40:1 | #a2acb9 | **2.30:1** | **FAIL** |

Gate result: 11/12 pass, `cancelled` on the light canvas fails → **R4 hard stop, R3 swap not
performed.** Pre-R1 baseline: `verifying` on light was 2.15:1 (`#f59e0b` on white) — R1 fixes it to
5.02:1 (re-computed this run: 2.15:1 baseline confirmed).

Commands run this turn:

- `bun /tmp/verify-0335-contrast.mjs` — independent re-computation; ratio table above reproduced
  exactly; gate FAIL on cancelled/light (exit output: "1 failing cell(s)").
- `bun test tests` (apps/web) — 518 pass, 0 fail, 1615 expect() calls, 32 files [4.46s].
- `bun run lint` (repo root) — Biome clean; all 7 workspaces `tsc --noEmit` exit 0.

Coverage: N/A (CSS token values + a gated no-op; no runtime code path added). The existing
apps/web suite guards the unchanged component contract.

**dev-unit pass (2026-07-26, `/sp:dev-unit 0335 --auto`)** — measured when moving to `testing`:

- `bun test --coverage tests/modules/features/` (apps/web) — 31 pass, 0 fail, 2 files;
  `src/modules/features/status-icons.tsx` 100% funcs / 100% lines, `FeatureTree.tsx` 100% / 100%.
- Gap analysis: no gap in task scope. The 0335 runtime surface is a gated no-op; the R1 change is
  CSS-only (not coverage-instrumented). Existing assertions cover all six statuses rendering, shape
  uniqueness, unknown-status fallback, and the domain-vocabulary re-export — behavior-meaningful.
  Asserting the frozen 4/2 class split would be implementation-detail testing against a contract R4
  froze deliberately, so no new tests added.
### Review
**Multi-dimensional review — 2026-07-26 (`/sp:dev-review 0335 --auto`)**

Scope caveat: the working tree mixes sibling tasks 0332–0336 (all uncommitted). The 0335 slice is
isolated to `apps/web/src/styles/global.css:39-41` (R1 light-theme tokens); the
`status-icons.tsx` modifications in the tree belong to 0332–0334. Lines 77/99/119 of
`status-icons.tsx` were re-read this run to confirm the R4 freeze holds.

**Functional traceability (sp-functional-review)**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/styles/global.css:39-41` — `--color-spur-success: #15803d`, `--color-spur-warning: #b45309`, `--color-spur-error: #dc2626` inside `[data-theme="light"]`; dark `@theme` values at lines 15-17 untouched |
| R2 | MET | Testing ratio table reproduced exactly this run by an independent re-computation (WCAG relative-luminance script): 12/12 values match (dark 7.36/4.22/8.79/5.01/8.28/3.40; light 4.76/6.29/5.02/4.83/5.02/2.30) |
| R3 | N/A — blocked by R4 (by design) | `status-icons.tsx:77` keeps `text-error`, `:99` keeps `text-success`; R3's condition precedent (all 12 ratios ≥ 3:1) failed, and the task's own ordering requirement makes the stop the required behavior, not a gap |
| R4 | MET | Gate fired on `cancelled`/light = 2.30:1 < 3:1; swap not performed; blocker recorded in Solution + Testing with three follow-up levers |

**Acceptance Criteria cross-check**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R10 scenario: all six statuses through one token family | UNMET (documented deviation) | static | `status-icons.tsx:77,99` — 4/2 split deliberately frozen by R4 |
| R10 scenario: each glyph ≥ 3:1 on both canvases | PARTIAL | command | 11/12 pass; `cancelled`/light = 2.30:1 (re-measured this run) |

R10 stays unsatisfied — that is the designed R4 outcome, not a miss. The AC must be carried by a
follow-up task that resolves the `cancelled` light-canvas contrast (Solution names three levers:
theme-conditional opacity drop, a dedicated `--color-spur-text-faint` token, or — rejected —
darkening `text-muted`).

**Design conformance**

| Claim | Status | Evidence |
|-------|--------|----------|
| Light-theme semantic tokens with candidate values | DONE | `global.css:39-41` matches the design's starting candidates exactly |
| Contrast measurement incl. `cancelled` 0.6 blend, recorded in Testing | DONE | Testing table; independently reproduced this run (`#a2acb9` blend on white = 2.30:1) |
| Gated swap (R3) | CHANGED | Documented deviation with Solution note asserting goal-equivalent intent (R4 hard stop) — PASS-acceptable per the deviation rule |

No scope creep in the 0335 slice.

**SECUA review (sp-code-verification, review mode)**

- Security: no findings — three CSS color declarations, no input surface.
- Efficiency: no findings.
- Correctness: light values verified ≥ 3:1 for their intended consumers (re-computed). `verifying`'s
  existing live consumer (`text-spur-warning`) improves from 2.15:1 to 5.02:1 on the light canvas —
  a real a11y fix shipped by R1 alone.
- Usability: light-canvas glyphs now legible except the pre-existing `cancelled` case (see F1).
- Architecture: token convergence intentionally incomplete; see C1.

Findings:

- **F1 (minor)** — `cancelled`/light = 2.30:1 is a live WCAG 1.4.11 failure in production today.
  Pre-existing, not introduced by this task, but now measured and owned by no open task. Action:
  create the follow-up task (Solution options 1–2) instead of letting it rest in a Solution note.
- **F2 (minor)** — `--color-spur-info: #3b82f6` (`global.css:18`) still has no light-theme override
  and no consumer — the same orphan pattern this task set out to eliminate, one token over. Out of
  0335 scope; fold into the follow-up.

**Architecture lenses (sp-code-improvement)**

- **C1 (advisory)** — tight coupling / wrong seam in `status-icons.tsx:119`: `cancelled` derives
  its color from `text-spur-text-muted opacity-60`, coupling a semantic status to an unrelated
  neutral token plus the panel background. This coupling IS the root cause of the R4 failure
  (2.30:1 light). Deepening proposal: a dedicated per-theme `--color-spur-text-faint` token
  (Solution option 2), or a theme-conditional class dropping `opacity-60` on light (option 1 —
  plain `text-spur-text-muted` on light measures 4.76:1 this run). Challenge: a new token adds a
  seventh status color to maintain per theme. Defense: the blend already IS a de-facto seventh
  color — naming it makes it governable and measurable. Non-blocking here; belongs to the F1
  follow-up task.
- Shallow module / weak locality / poor test surface: no hits in the 0335 slice (three CSS
  declarations; component contract unchanged and fully covered — `status-icons.tsx` 100%
  funcs/lines per the dev-unit pass).

**Verification re-run this turn**

- Independent WCAG re-computation (`bun`, throwaway script): 12/12 ratios match the Testing table.
- `bun test tests` (apps/web): 518 pass, 0 fail, 32 files [5.39s].

**Disposition**

Functional Verdict: **PASS** (R3 correctly blocked by R4 per the task's own normative ordering;
documented deviation, not a gap). SECUA: no blocker/major findings; F1/F2 minor, both routed to a
recommended follow-up task. Architecture: C1 advisory. Residual risk: the unsatisfied R10 AC and
the live `cancelled` light-canvas contrast failure — both need a follow-up task to close.

**Findings (P1–P4)**

| # | Priority | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | P3 | `cancelled` glyph light-canvas contrast 2.30:1 < 3:1 (WCAG 1.4.11) | Routed to follow-up task 0338 (operator accepted R4 outcome 2026-07-26) |
| F2 | P3 | 4/2 token-family split retained (`text-error`/`text-success` vs Spur tokens); AC R10 unsatisfied | Routed to follow-up task 0338 — swap deferred by R4 gate |
| F3 | P4 | Design section contains gate language (L4 advisory) | Accepted — the ordering gate is the task's normative requirement (ADR-034 (2)) |
| C1 | P4 | Advisory: de-facto seventh status color (opacity blend) is unnamed/ungoverned | Deepening proposal recorded; belongs to 0338 |
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T19:39:55.494Z todo → wip (system)
- 2026-07-26T19:41:29.251Z wip → testing (system)
- 2026-07-26T20:09:08.708Z testing → done (system)
