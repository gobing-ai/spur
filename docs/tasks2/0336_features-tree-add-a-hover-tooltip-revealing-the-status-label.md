---
template: feature-impl
schema_version: 1
name: "Features tree: add a hover tooltip revealing the status label"
description: ""
status: done
type: task
profile: standard
feature_id: R2
parent_wbs: null
priority: P2
tags: ["web", "features", "ui"]
dependencies: ["0332"]
created_at: "2026-07-26T00:26:23.975Z"
updated_at: "2026-07-26T22:08:20.255Z"
---

## 0336. Features tree: add a hover tooltip revealing the status label

### Background

With the text label gone from the tree, sighted pointer users need a way to learn what an unfamiliar glyph means. This is a visual enhancement layered on top of the accessible name established earlier in the feature — per ADR-034 (3) a tooltip is never the sole channel, so this task must not become load-bearing. The mechanism is deliberately unresolved: daisyUI 5.0.29 is declared at apps/web/package.json:24 but is not installed in the local tree and its tooltip/data-tip contract could not be verified, and no tooltip primitive exists in apps/web/src/components/ui/ (11 primitives, none a Tooltip) nor is tooltip used anywhere in apps/web/src. Design: docs/design/feature-tree-status-affordance.md §2.

### Requirements
R1. Verify first whether daisyUI's `tooltip` / `data-tip` class is actually available in the installed
    toolchain. daisyUI `5.0.29` is declared at `apps/web/package.json:24` but was not resolvable in
    the local tree at planning time, so the contract is unconfirmed.

R2. If it is available, use it. If it is not, add a small local presentational wrapper instead. Do not
    add a new third-party dependency for this.

R3. Hovering a tree row's status indicator must reveal its human-readable label.

R4. Keep the tooltip presentational only: deleting it must leave the indicator's accessible name
    intact. Assert that property in a test so the tooltip cannot silently become the sole channel
    (ADR-034 (3)).

R5. Do not use the native `title` attribute as the mechanism — it is not keyboard-reachable and is
    announced inconsistently by screen readers.

Depends on task 0332 for the accessible name this tooltip layers on top of.

Satisfies feature AC scenario R5 — see this task's Acceptance Criteria section.
### Acceptance Criteria
```gherkin
Feature: Features tree status affordance (R2) — task 0336

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R5 — Hovering the indicator reveals the status label visually
    Given a feature "F1" with status "blocked" is present in the tree
    When the operator hovers the pointer over its status indicator
    Then the label "Blocked" becomes visible
    And removing the tooltip affordance would leave R3's accessible name intact

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** R1 verified at design time: daisyUI `5.0.29` **is** installed
(`apps/web/node_modules/daisyui/`, `utilities/tooltip/tooltip.css` present) and wired via
`@plugin "daisyui"` in `global.css:2` — so use daisyUI's tooltip (`tooltip` class + `data-tip`
attribute). No new dependency, no local wrapper (R2).

- **Host.** Apply `tooltip tooltip-right` + `data-tip={label}` on the tree row's status-indicator
  slot (the fixed `w-4` span from 0333; if the batch ordering changes and 0333 has not landed, wrap
  the `FeatureStatusIcon` usage instead — integrate with the leading slot when present). The
  tooltip wraps the indicator only, not the whole row, so hovering the indicator reveals the label
  (AC R5). `tooltip-right` opens toward the row content, avoiding clipping at the panel edge.
- **One label source.** `data-tip` derives from the same `FEATURE_STATUS_MAP` lookup as the
  accessible name (`meta.label`, fallback `Unknown status: ${status}`) so the visual and semantic
  channels can never disagree.
- **Presentational only (R4, ADR-034 (3)).** daisyUI's tooltip is pure CSS (`::before`/`::after`
  content from `data-tip`, hover-triggered) — it contributes no accessible name. The `role="img"` +
  `aria-label` from 0332 remains the sole semantic channel. Add a test asserting the indicator's
  accessible name is intact with the tooltip affordance absent, so the tooltip cannot silently
  become load-bearing.
- **No `title` attribute** anywhere (R5).

**Tradeoff.** daisyUI's tooltip is hover-only (not keyboard-reachable) — acceptable because it is a
redundant visual channel; keyboard and AT users already have the accessible name. Chosen over a
custom focusable tooltip deliberately: adding keyboard popover behavior would make the tooltip a
second semantic channel to maintain, against ADR-034 (3)'s single-channel rule.

**Impacted surfaces:** `FeatureTree.tsx` (slot attributes); `components.test.tsx`.
### Plan
- [x] 1. Record the R1 verification in Testing: daisyUI 5.0.29 installed,
  `utilities/tooltip/tooltip.css` present, `@plugin "daisyui"` in `global.css` — contract confirmed.
- [x] 2. Add a shared label derivation (reuse the `FEATURE_STATUS_MAP` lookup with the unknown-status
  fallback) so `data-tip` and `aria-label` share one source.
- [x] 3. Apply `tooltip tooltip-right` + `data-tip={label}` to the indicator slot in
  `FeatureTree.tsx` (integrating with the leading slot from 0333).
- [x] 4. Tests: the indicator slot exposes `data-tip` with the human label; accessible name intact
  with the tooltip affordance removed; no `title` attribute rendered anywhere in the row.
- [x] 5. Run apps/web tests + `bun run lint`.
### Solution
Implemented daisyUI tooltip on the feature-tree status indicator (R1–R5).

- `apps/web/src/modules/features/status-icons.tsx:144` — added exported `featureStatusLabel(status)`:
  the single label source (`FEATURE_STATUS_MAP` lookup, `Unknown status: ${status}` fallback).
  `FeatureStatusIcon`'s unknown-status fallback now routes through it (`status-icons.tsx:163`)
  instead of an inline literal.
- `apps/web/src/modules/features/FeatureTree.tsx:78-85` — the leading status-indicator slot (the
  fixed `w-4` span from 0333, `data-testid="feature-tree-status"`) now carries
  `tooltip tooltip-right` + `data-tip={featureStatusLabel(feature.status)}`. `flex!` pins
  `display:flex` because the cascade probe showed daisyUI's `.tooltip{display:inline-block}` emits
  later in `@layer utilities` than Tailwind's `.flex` and would otherwise win on equal specificity.
- `apps/web/tests/modules/features/components.test.tsx:292-338` — 4 new tests in the FeatureTree
  block: data-tip carries the human label and agrees with the icon's `aria-label` (one label
  source); unknown-status fallback parity between `data-tip` and `aria-label`; accessible name
  intact after stripping `data-tip` + tooltip classes (R4 / ADR-034 (3) — tooltip can never become
  the sole channel); zero `title` attributes anywhere in the rendered tree (R5).

Decisions:
- R1/R2: daisyUI 5.0.29 confirmed installed and wired (see Testing) → used daisyUI's pure-CSS
  `tooltip`/`data-tip`. No new dependency, no local wrapper, no third-party addition.
- Tooltip wraps the indicator slot only, not the whole row; `tooltip-right` opens toward the row
  content to avoid clipping at the panel edge (per Design).
- Hover-only channel accepted deliberately: keyboard/AT users already have the 0332 accessible
  name; a focusable popover would create a second semantic channel against ADR-034 (3).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 (verify daisyUI tooltip availability) | MET | `apps/web/node_modules/daisyui/package.json` → `"version": "5.0.29"` (read this run); `node_modules/daisyui/components/tooltip.css` present, defines `.tooltip{display:inline-block...}` + `[data-tip]:before{content:attr(data-tip)}` + `.tooltip-right` variant (read this run); `apps/web/src/styles/global.css:2` → `@plugin "daisyui"` |
| R2 (use daisyUI if available; no new dep) | MET | `FeatureTree.tsx:80-83` applies `tooltip tooltip-right` + `data-tip={featureStatusLabel(feature.status)}`; `git status --short` shows no `apps/web/package.json` or lockfile change → no new dependency added |
| R3 (hover reveals human label) | MET | `FeatureTree.tsx:82` slot carries `data-tip={featureStatusLabel(feature.status)}`; daisyUI tooltip is pure CSS hover (`[data-tip]:before` opacity transition, `components/tooltip.css:1`); test `indicator slot carries a daisyUI tooltip whose data-tip is the human status label` (`components.test.tsx:292-303`) asserts `data-tip="Blocked"` — 31/31 pass this run |
| R4 (presentational only; accessible name survives removal) | MET | Test `removing the tooltip affordance leaves the accessible name intact (ADR-034)` (`components.test.tsx:313-329`) strips `data-tip` + tooltip classes, asserts `role="img"` + `aria-label="Blocked"` intact; daisyUI tooltip contributes no accessible name (CSS `content` only) |
| R5 (no native `title` as the mechanism) | MET | `grep 'title='` over `FeatureTree.tsx` + `status-icons.tsx` → zero hits (this run); test `no title attribute is rendered anywhere in a tree row` (`components.test.tsx:331-338`). Pre-existing `title=` in `FeatureDetail.tsx:523` and `FeaturesShell.tsx:170,243` are unrelated to the feature-tree status indicator mechanism and outside 0336's scope. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS, re-derived this turn)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | None. No blocker findings across S/E/C/U/A. |
| P2 | — | — | None. No major findings. |
| P3 | — | — | None. No minor findings requiring action this task. |
| P4 | Architecture | `status-icons.tsx:144-147` | Advisory: `featureStatusLabel` co-located with `FEATURE_STATUS_MAP` gives one label source consumed by both `data-tip` (`FeatureTree.tsx:82`) and `FeatureStatusIcon`'s `aria-label` (`status-icons.tsx:163`) — strong locality; no deepening candidate. |
| P4 | Correctness | `status-icons.tsx:144-147,150-163` | Advisory: `featureStatusLabel` and `FeatureStatusIcon` both `.toLowerCase()` before lookup → `data-tip` and `aria-label` agree for case variants and unknown statuses. Clean. |
| P4 | Architecture | `FeatureTree.tsx:77-78` | Advisory: `flex!` cascade WHY-comment is the right kind of comment; daisyUI `.tooltip{display:inline-block}` emits after Tailwind `.flex` in `@layer utilities`, requiring `flex!`. |
| P4 | Usability | `FeatureTree.tsx:80` | Advisory: `tooltip-right` opens toward row content to avoid panel-edge clipping per Design. |
| P4 | Security | `FeatureTree.tsx:82` | Advisory: `data-tip` is a React-escaped attribute rendered as CSS `content` text — no HTML/injection surface; no secrets. |

**Functional traceability** — all requirements R1–R5 MET (see `### Testing` for the per-requirement table with file:line evidence; re-derived this turn, not from self-report).

**Architecture (deepening lenses)** — no candidates. No shallow-module, coupling, seam, locality, or test-surface signals in this diff. Patterns consistent with DESIGN.md / `docs/design/feature-tree-status-affordance.md`.

**Advisory notes (carried from prior review, non-blocking):**
- `StatusMeta.Icon`'s `ariaLabel` prop is optional; a future caller using `FEATURE_STATUS_MAP[x].Icon` directly without it would render `role="img"` unnamed. Today the only caller is `FeatureStatusIcon`, which always passes `meta.label` (verified by grep). No action required now.
- daisyUI `components/tooltip.css` banner reads "5.0.28" while `package.json` reports 5.0.29 — upstream packaging artifact; no action.
- Pre-existing `title=` attributes in `FeatureDetail.tsx:523` and `FeaturesShell.tsx:170,243` are unrelated to 0336's feature-tree status indicator mechanism and outside this task's scope.

**Verification evidence (run this turn):**
- `bun test tests/modules/features/components.test.tsx` (apps/web) → 31 pass / 0 fail.
- `bun test` (apps/web) → 522 pass / 0 fail across 32 files.
- `bun run lint` → Biome (537 files) + per-workspace `tsc --noEmit` all exit 0.
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T20:19:01.285Z todo → wip (system)
- 2026-07-26T20:20:33.188Z wip → testing (system)
- 2026-07-26T22:06:43.923Z testing → done (system)
