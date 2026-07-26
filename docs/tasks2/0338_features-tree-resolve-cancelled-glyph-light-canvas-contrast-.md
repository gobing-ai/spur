---
template: feature-impl
schema_version: 1
name: "Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10)"
description: ""
status: wip
type: task
profile: standard
feature_id: R2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0335"]
created_at: "2026-07-26T20:07:54.169Z"
updated_at: "2026-07-26T23:03:26.871Z"
---

## 0338. Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10)

### Background
Follow-up to task 0335 (R2). 0335 added light-theme values for `--color-spur-success` /
`--color-spur-warning` / `--color-spur-error` and measured all six status glyphs on both canvases
(12/12 ratios recorded in its Testing section). The R4 gate fired: the `cancelled` glyph
(`text-spur-text-muted` at `opacity-60`, effective `#a2acb9`) measures **2.30:1 on the light canvas
(`#ffffff`)**, below the WCAG 1.4.11 3:1 floor — so the token swap (`text-error`→`text-spur-error`,
`text-success`→`text-spur-success` in `status-icons.tsx`) was deliberately NOT performed and the 4/2
token-family split remains. Feature AC scenario R10 (single token family + ≥3:1 on both canvases)
is unsatisfied until this task lands. Operator accepted the R4 outcome on 2026-07-26 with R10
carried here.

Levers named by the 0335 review (pick during refine): (1) theme-conditional opacity drop for
`cancelled` on `[data-theme="light"]`; (2) a dedicated `--color-spur-text-faint` token with
per-theme values; (3) — rejected — darkening `text-muted` globally (would ripple across all muted
text).
### Requirements
- [ ] R1. Raise the `cancelled` glyph's contrast on the light canvas to ≥ 3:1 (WCAG 1.4.11) without
    regressing its dark-canvas ratio (currently 3.40:1) and without changing `text-muted` globally.
- [ ] R2. Re-measure all six glyphs on both canvases after the fix (same method as 0335: WCAG
    relative luminance, cancelled measured with its effective blended color); record the 12 ratios.
- [ ] R3. With all 12 ratios ≥ 3:1, complete the deferred swap: `blocked` → `text-spur-error`,
    `done` → `text-spur-success` in `apps/web/src/modules/features/status-icons.tsx`, so all six
    statuses resolve through the Spur token family.
- [ ] R4. Satisfy feature AC scenario R10 (single token family + ≥ 3:1 on both canvases).
### Acceptance Criteria
Derived from parent feature R2 scenario **R10** (`docs/features/R2_*.md:156-161`) and
task requirements R1–R4. R-numbered for traceability; titles are identity keys — keep stable.

@core
Scenario: R1 — cancelled glyph reaches ≥ 3:1 contrast on the light canvas without a dark regression
  Given the `cancelled` status indicator renders on the light theme canvas (#ffffff panel)
  When its effective color is measured per WCAG 1.4.11 relative luminance
  Then the contrast ratio is at least 3:1
  And the same glyph measured on the dark theme canvas (#0f1117 panel) remains at least 3:1
  And `--color-spur-text-muted` is not changed globally (no ripple to other muted text)

@core
Scenario: R2 — all six glyphs re-measured on both canvases, 12/12 ≥ 3:1
  Given the tree renders all six canonical statuses (backlog, active, verifying, blocked, done, cancelled)
  When each glyph's effective color is measured on both the dark and light canvas
  Then all twelve recorded ratios are at least 3:1
  And the twelve ratios are recorded in the Testing section (same method as 0335)

@core
Scenario: R3 — blocked and done swap onto the Spur token family
  Given R1 and R2 pass (all twelve ratios ≥ 3:1)
  When the `colorClass` of `blocked` and `done` in `status-icons.tsx` is inspected
  Then `blocked` resolves to `text-spur-error` (was `text-error`)
  And `done` resolves to `text-spur-success` (was `text-success`)
  And `cancelled` resolves to `text-spur-text-faint` (was `text-spur-text-muted opacity-60`)

@core
Scenario: R4 — feature AC R10 satisfied (single token family + ≥ 3:1 on both canvases)
  Given the swap from R3 is in place
  When the color class of each of the six status indicators is inspected
  Then all six resolve through the `text-spur-*` token family
  And each glyph has a contrast ratio of at least 3:1 against the panel background
  And that holds on both the dark and the light theme canvas

@edge
Scenario: R5 — existing component contract intact (no behavioral regression)
  Given the changes from R1–R3 are applied
  When the apps/web test suite runs
  Then all six statuses still render their assigned glyph shape
  And each indicator still exposes `role="img"` + the human status label as accessible name
  And the unknown-status fallback path is unchanged
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Chosen approach: lever 2 — a dedicated `--color-spur-text-faint` token with per-theme values.

0335's review named three levers; this task picks lever 2 and rejects the other two:

- Lever 1 (theme-conditional opacity drop for `cancelled` on `[data-theme="light"]`) — rejected.
  `opacity-60` lives on the component class (`colorClass`); a theme-scoped CSS override of a
  Tailwind v4 utility is brittle, and it changes the glyph's visual weight per-canvas (the
  cancelled mark would read heavier on light than dark).
- Lever 2 (dedicated `--color-spur-text-faint` token, per-theme values) — **chosen**. Mirrors the
  exact pattern 0335 established for success/warning/error (`@theme` dark +
  `[data-theme="light"]` override at `global.css:37-41`); one tunable knob per canvas; removes the
  `opacity-60` blunt instrument, which blends against whatever sits behind the element and is not
  contrast-controlled.
- Lever 3 (darken `--color-spur-text-muted` globally) — rejected in the 0335 Background; not
  revisited. Ripples across every muted surface.

Token contract (single source of truth for implement + verify):

```css
@theme {
  /* dark value reproduces today's effective blended color (#5f6978) -> 3.40:1 on #0f1117, unchanged */
  --color-spur-text-faint: #5f6978;
}
[data-theme="light"] {
  /* tuned for >= 3.3:1 on #ffffff (margin above the 3:1 floor); slate hue family of text-muted */
  --color-spur-text-faint: #7c8699;
}
```

Dark value `#5f6978` is the exact effective color 0335 measured for `cancelled` on dark
(`text-spur-text-muted opacity-60` blended against `#0f1117`). Setting the solid token to that
value makes the rendered pixel identical -> dark ratio stays 3.40:1, no regression, and we delete
the opacity hack.

Light value `#7c8699` targets the window 3.3-3.8:1 on white. Linearized sRGB luminance ~0.237 ->
ratio ~3.66:1 (computed `1.05 / (0.237 + 0.05)`). The implement step runs
`/tmp/verify-0338-contrast.mjs` to lock the final hex; if the measured ratio slips below 3.3:1 or
exceeds 3.8:1, nudge within the slate family (`#778395` darker, `#8290a5` lighter) and re-run
until in window.

Component change (`apps/web/src/modules/features/status-icons.tsx:119`):

```diff
- colorClass: 'text-spur-text-muted opacity-60',
+ colorClass: 'text-spur-text-faint',
```

The `cancelled` glyph (`Icon` at lines 120-135) is otherwise unchanged — same octagon + X paths,
same `role="img"` + `aria-label` contract from 0332.

R3 swap — completes the convergence 0335's R4 gate froze:

- blocked (line 77): `text-error` -> `text-spur-error`
- done (line 99): `text-success` -> `text-spur-success`

Both were the "staged" values 0335 measured as passing on both canvases (blocked 5.01/4.83,
done 8.28/5.02). With R1 lifting cancelled/light above the floor, R10's "all six through one token
family + >= 3:1 on both canvases" is finally satisfiable.

Invariants:

- `--color-spur-text-muted` is not touched (R1 anti-ripple guard).
- The accessible-name and tooltip channels (`featureStatusLabel`, R5 of 0336) are untouched —
  this is a presentational color change only; no semantic change.
- No new dependency. Token is plain CSS in `global.css`, same file 0335 edited.

Impacted surfaces:

- `apps/web/src/styles/global.css` — add `--color-spur-text-faint` to `@theme` (after line 12,
  in the identity-palette block) and to `[data-theme="light"]` (after line 35).
- `apps/web/src/modules/features/status-icons.tsx:77,99,119` — three `colorClass` edits.
- `apps/web/tests/modules/features/components.test.tsx` — no new test required for R1-R4 (contrast
  is a CSS-token property, not a runtime path; the existing "all six statuses render" +
  accessible-name + shape-uniqueness assertions guard the behavioral contract). R5 re-runs the
  suite as the regression gate.

Out of scope: glyph shape/size/stroke width (0334); tooltip mechanism (0336); any status other
than blocked/done/cancelled.
### Plan
- [x] 1. Add `--color-spur-text-faint: #5f6978;` to the `@theme` block in
      `apps/web/src/styles/global.css` (after `--color-spur-text-muted`, line 12).
- [x] 2. Add `--color-spur-text-faint: #7c8699;` to the `[data-theme="light"]` block
      (3.3-3.8:1 on white) and the link to 0335.
- [x] 3. Write `/tmp/verify-0338-contrast.mjs` (port of 0335's contrast script) that computes the
      WCAG 1.4.11 ratio for all six statuses on both canvases, with `cancelled` reading the solid
      `--color-spur-text-faint` value (no opacity blend). Run it; confirm cancelled-light is in the
      3.3-3.8:1 window and cancelled-dark is unchanged at >= 3.40:1. Nudge the light hex if outside
      the window and re-run until in window. Record the final hex + the 12 ratios.
- [x] 4. With R1/R2 confirmed, perform the R3 swap in `status-icons.tsx`:
      line 77 `text-error` -> `text-spur-error`; line 99 `text-success` -> `text-spur-success`;
      line 119 `text-spur-text-muted opacity-60` -> `text-spur-text-faint`.
- [x] 5. Re-run `/tmp/verify-0338-contrast.mjs` post-swap; confirm all 12 ratios still >= 3:1
      (blocked/done were already proven by 0335; this is the gating re-measurement).
- [x] 6. Run `bun test` (apps/web) and `bun run lint`; confirm no regression — all six statuses
      still render, accessible names intact, shape uniqueness intact (R5 gate).
- [x] 7. Fill `### Solution` with the file:line change map and the final token values; fill
      `### Testing` with the 12-ratio table + the suite/lint evidence.
### Solution
**Outcome: R1 lifts `cancelled`/light to 3.67:1 (in the 3.3-3.8:1 window) with no dark regression (3.40:1 held); the R4 gate that froze 0335's R3 swap now passes; all six statuses resolve through the `text-spur-*` token family. AC R10 satisfied.**

Change map (3 files):

- `apps/web/src/styles/global.css` — added `--color-spur-text-faint` to both theme blocks.
  - `@theme` (after `--color-spur-text-muted`, now line 17): `--color-spur-text-faint: #5f6978`.
    Reproduces the exact effective blended color the `text-spur-text-muted opacity-60` hack
    produced on the dark canvas, so the rendered pixel is identical → dark ratio stays 3.40:1.
  - `[data-theme="light"]` (after `--color-spur-text-muted`, now line 44): `--color-spur-text-faint: #7c8699`.
    Slate hue family of `text-muted`; measures 3.67:1 on `#ffffff`.
- `apps/web/src/modules/features/status-icons.tsx` — three `colorClass` swaps (lines 77, 99, 119):
  - `blocked`: `text-error` → `text-spur-error` (R3).
  - `done`: `text-success` → `text-spur-success` (R3).
  - `cancelled`: `text-spur-text-muted opacity-60` → `text-spur-text-faint` (R1).
- `/tmp/verify-0338-contrast.mjs` — throwaway evidence script (port of 0335's method); not committed.

Invariants held:

- `--color-spur-text-muted` untouched (R1 anti-ripple guard) — verified by re-read of `global.css:11,40`.
- Glyph shapes, `role="img"`, `aria-label`, and the unknown-status fallback path are unchanged
  (presentational color change only; no semantic change) — R5 contract intact, suite green.
- The accessible-name/tooltip channel (`featureStatusLabel`, 0336) is untouched.
- No new dependency. Token is plain CSS in `global.css`, same file 0335 edited.

Why lever 2 (dedicated token) over the alternatives 0335's review named:

- Lever 1 (theme-conditional opacity drop on `[data-theme="light"]`) — rejected in refine: a
  theme-scoped CSS override of a Tailwind v4 utility is brittle and changes the glyph's visual
  weight per-canvas.
- Lever 3 (darken `--color-spur-text-muted` globally) — rejected in 0335 Background; ripples across
  every muted surface. Not revisited.
- Lever 2 makes the de-facto seventh status color (the opacity blend) named and governable — the
  architecture advisory C1 from 0335's review is resolved by this task.
### Testing
**Verify run — 2026-07-26 (`/skill:sp-dev-run --mode implement 0338 --auto`).** All evidence
produced this turn; line anchors re-read at the cited lines.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `global.css:17` (`--color-spur-text-faint: #5f6978`) + `global.css:44` (`--color-spur-text-faint: #7c8699`); cancelled/light re-measured at 3.67:1 (≥ 3:1, in the 3.3-3.8:1 window); cancelled/dark held at 3.40:1 (≥ 3:1, no regression); `--color-spur-text-muted` untouched (anti-ripple) |
| R2 | MET | 12-ratio table below, computed this run by `bun /tmp/verify-0338-contrast.mjs`; 12/12 ≥ 3:1 |
| R3 | MET | `status-icons.tsx:77` = `text-spur-error` (was `text-error`); `:99` = `text-spur-success` (was `text-success`); `:119` = `text-spur-text-faint` (was `text-spur-text-muted opacity-60`) — all six now on the Spur token family |
| R4 | MET | All six `colorClass` values resolve through `text-spur-*`; all 12 ratios ≥ 3:1 on both canvases (gate that froze 0335's R3 now passes) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1: cancelled ≥ 3:1 on light, no dark regression, no global text-muted change | MET | command + static-ref | `bun /tmp/verify-0338-contrast.mjs` — cancelled/light 3.67:1, cancelled/dark 3.40:1; `global.css:11,40` (`--color-spur-text-muted`) unchanged |
| R2: all six glyphs re-measured on both canvases, 12/12 ≥ 3:1 | MET | command | `bun /tmp/verify-0338-contrast.mjs` — table below |
| R3: blocked → `text-spur-error`, done → `text-spur-success`, cancelled → `text-spur-text-faint` | MET | static-ref | `status-icons.tsx:77,99,119` |
| R4: feature AC R10 — all six through one token family, ≥ 3:1 on both canvases | MET | command + static-ref | All six `colorClass` values are `text-spur-*`; 12/12 ratios ≥ 3:1 |
| R5: existing component contract intact (regression gate) | MET | command | `bun test tests` (apps/web) — 522 pass, 0 fail, 1626 expect() calls, 32 files |

**R2 contrast evidence** — WCAG 1.4.11 ratios ($L = 0.2126R + 0.7152G + 0.0722B$ on linearized
sRGB; ratio $= \frac{L_1+0.05}{L_2+0.05}$). Dark panel `#0f1117`, light panel `#ffffff`. After R1,
`cancelled` reads the solid `--color-spur-text-faint` token (no opacity blend).

| status | class | dark glyph | dark ratio | light glyph | light ratio | pass? |
|---|---|---|---|---|---|---|
| backlog | text-spur-text-muted | #94a3b8 | 7.36:1 | #64748b | 4.76:1 | PASS |
| active | text-spur-accent | #6366f1 | 4.22:1 | #4f46e5 | 6.29:1 | PASS |
| verifying | text-spur-warning | #f59e0b | 8.79:1 | #b45309 | 5.02:1 | PASS |
| blocked | text-spur-error | #ef4444 | 5.01:1 | #dc2626 | 4.83:1 | PASS |
| done | text-spur-success | #22c55e | 8.28:1 | #15803d | 5.02:1 | PASS |
| cancelled | text-spur-text-faint | #5f6978 | 3.40:1 | #7c8699 | 3.67:1 | PASS |

Gate result: 12/12 pass. `cancelled` light-canvas contrast rises from 2.30:1 (0335 pre-R1) to 3.67:1;
dark stays at 3.40:1 (no regression — `#5f6978` is the exact effective color the opacity-60 blend
produced, now set as a solid token).

Pre-R1 baseline reproduced this run (cancelled opacity-60 blend, for the no-regression audit):
dark blend `#5f6978` → 3.40:1 (0335 recorded 3.40:1 ✓); light blend `#a2acb9` → 2.30:1
(0335 recorded 2.30:1 ✓).

Commands run this turn:

- `bun /tmp/verify-0338-contrast.mjs` — 12/12 ratios ≥ 3:1; cancelled/light 3.67:1 (in 3.3-3.8:1
  window); cancelled/dark 3.40:1 (held); gate PASS (exit 0).
- `bun test tests` (apps/web) — 522 pass, 0 fail, 1626 expect() calls, 32 files [4.64s].
- `bun run lint` (repo root) — Biome clean (537 files); all 7 workspaces `tsc --noEmit` exit 0.

Coverage: N/A (CSS token values + three class-string swaps; no runtime code path added). The
existing apps/web suite guards the unchanged component contract (R5): all six statuses render,
shape uniqueness, accessible names, unknown-status fallback.
### Review
**Review run — 2026-07-26 (`/skill:sp-dev-review 0338 --auto`).** All evidence reproduced this turn: line anchors re-read at the cited lines, contrast script re-run, suite + lint re-run.

**Functional Verdict: PASS**

Per-Requirement Traceability (re-verified this turn):

| Req | Status | Evidence (re-read this run) |
|-----|--------|------------------------------|
| R1 | MET | `global.css:17` (`--color-spur-text-faint: #5f6978`) + `global.css:44` (`--color-spur-text-faint: #7c8699`); `bun /tmp/verify-0338-contrast.mjs` this run → cancelled/light **3.67:1**, cancelled/dark **3.40:1** held; `global.css:11,40` (`--color-spur-text-muted`) unchanged across 80+ other surfaces (anti-ripple) |
| R2 | MET | 12/12 ≥ 3:1 in the re-run table below |
| R3 | MET | `status-icons.tsx:77` = `text-spur-error`; `:99` = `text-spur-success`; `:119` = `text-spur-text-faint` (no `opacity-60`, no `text-error`/`text-success` leak) |
| R4 | MET | All six `colorClass` resolve through `text-spur-*`; 12/12 ratios ≥ 3:1 on both canvases — feature AC R10 satisfied |

Acceptance Criteria:

| AC | Status | Evidence |
|----|--------|----------|
| R1 (cancelled ≥ 3:1 light, no dark regression, no global text-muted change) | MET | command `bun /tmp/verify-0338-contrast.mjs` exit 0; static `global.css:11,40` |
| R2 (12/12 ≥ 3:1) | MET | command — table below |
| R3 (blocked→spur-error, done→spur-success, cancelled→spur-text-faint) | MET | static `status-icons.tsx:77,99,119` |
| R4 (R10: single token family + ≥ 3:1 both canvases) | MET | command + static |
| R5 (component contract intact — regression gate) | MET | command `cd apps/web && bun test tests` → **524 pass / 0 fail / 1665 expect() / 32 files** [4.48s] |

R2 contrast table (re-computed this run):

| status | class | dark ratio | light ratio | pass? |
|---|---|---|---|---|
| backlog | text-spur-text-muted | 7.36:1 | 4.76:1 | PASS |
| active | text-spur-accent | 4.22:1 | 6.29:1 | PASS |
| verifying | text-spur-warning | 8.79:1 | 5.02:1 | PASS |
| blocked | text-spur-error | 5.01:1 | 4.83:1 | PASS |
| done | text-spur-success | 8.28:1 | 5.02:1 | PASS |
| cancelled | text-spur-text-faint | 3.40:1 | 3.67:1 | PASS |

12/12 PASS. Cancelled/light rose from 2.30:1 (0335 baseline) to 3.67:1; cancelled/dark held at 3.40:1 (the `#5f6978` solid token reproduces the exact opacity-60 blend).

**SECU findings (P1–P4)**

| Priority | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P4 | `docs/tasks2/0338_*.md` | Testing write-back records `522 pass / 1626 expect() calls`, but the suite at review time is `524 pass / 1665 expect() calls` — counts stale relative to the current tree (grew between implement write and review). Not a regression; gate still clears. | Capture suite counts at transition time in the `record` step, or phrase the assertion as a lower bound (`≥ 522 pass`). Non-blocking. |
| P4 | `apps/web/tests/modules/features/components.test.tsx` | The per-status `colorClass` is asserted (lines 417–451), but the WCAG ratio itself is not — the contrast gate depends on a manual re-run of the untracked `/tmp/verify-0338-contrast.mjs`. A future token edit could regress contrast with no tracked signal. | Add a tracked unit test that asserts token hex → WCAG ratio (≥ 3:1 on both canvases) so token edits become self-gating. Defer to a follow-up; non-blocking. |

No P1/P2/P3 findings. No blockers, no majors. The two P4 advisories do not block the `approve(HITL)` gate.

**SECUA dimension summary** (scope narrowed to 0338's actual delta: two CSS token additions `global.css:12-17,41-44` and three `colorClass` swaps in `status-icons.tsx:77,99,119`; the broader working-tree changes — icon shapes, `role="img"`, FeatureTree rewrite — belong to 0332–0337, out of scope here):

- **S** — No injection surface; CSS values are hardcoded hex literals. No secrets. PASS.
- **E** — No runtime cost; static CSS tokens compiled at build time. PASS.
- **C** — Contrast arithmetic independently reproduced (script exit 0); dark value `#5f6978` verified bit-exact against the recorded pre-R1 blend (`#5f6978` → 3.40:1, matches 0335). Light value `#7c8699` measures 3.67:1, inside the design's 3.3–3.8:1 window. PASS.
- **U** — API surface unchanged; the new token is consumed at exactly one site (`status-icons.tsx:119`); the old `opacity-60` hack is fully removed (not aliased). PASS.
- **A** — Mirrors the exact pattern 0335 established for success/warning/error (dark in `@theme`, light override in `[data-theme="light"]`, paired comment block). Co-located with siblings; no seam drift. PASS.

**Architecture review (sp-code-improvement)**

- No shallow module introduced. The new token names a primitive where a de-facto seventh status color (the opacity blend) previously lived unnamed — this *deepens* the module (resolves 0335 advisory C1).
- No tight coupling: token consumed at one site; no coordinated multi-package change.
- Right seam: a presentational primitive (CSS custom property) at the style layer, matching the established success/warning/error seam rather than introducing a new abstraction level.
- Locality: dark and light values sit alongside their semantic-color siblings in the same two blocks.
- Test surface: `colorClass` resolution is asserted directly in the tracked suite; the contrast arithmetic is the only untracked portion (P4 above).

No blocker / major / minor architecture candidates. The single advisory is shared with SECUA (P4 row 2).

**Disposition**

Functional: PASS. SECUA: PASS (no P1–P3). Architecture: PASS (no blocker/major). Gate clears for `approve(HITL)` → `record` → `done`. The two P4 advisories are record-step hygiene and a deferred follow-up; neither blocks.

Verdict: PASS
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T22:55:19.075Z todo → wip (system)
