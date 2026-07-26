---
date: 2026-07-25
topic: Feature-tree status affordance redesign (Spur Board → Features → FEATURES panel)
needs_design: true
scope: apps/web
---

# Brainstorm — Feature-tree status affordance

## Overview

The FEATURES left panel renders each tree row as `[id] [name] [status badge]`, where the badge is a
bordered outline pill carrying an SVG icon **and** the raw status string, pinned to the trailing edge
(`apps/web/src/modules/features/FeatureTree.tsx:104-117`). At tree densities the repeated pill chrome
plus six different word-lengths creates a ragged right edge and visual noise that competes with the
feature names — the thing the operator is actually scanning.

The proposal: drop the text and the pill chrome, move the icon to the **leading** edge (before the
feature id), and add a tooltip so the icon stays self-describing.

The proposal is directionally right. Grounding it against the code surfaced four latent defects that
a naive icon-only swap would *worsen*, and which any mature version of this change must absorb.

### Evidence base

All verified locally against the working tree on 2026-07-25. Confidence **HIGH** unless noted.

| # | Finding | Location |
|---|---|---|
| E1 | `StatusBadge` renders `variant="outline"` pill with icon + raw status text, trailing position. Both `title` and `aria-label` are `Status: ${status}` — the raw lowercase status. | `FeatureTree.tsx:104-117` |
| E2 | `FEATURE_STATUS_MAP` carries a human-readable `label` field (`'Backlog'`, `'Verifying'`, …) that **nothing reads**. The badge renders the raw `status` instead. Dead data. | `status-icons.tsx` (`StatusMeta.label`) |
| E3 | **Mixed color provenance**, split 4/2. Spur tokens: backlog `text-spur-text-muted`, active `text-spur-accent`, verifying `text-spur-warning`, cancelled `text-spur-text-muted opacity-60`. daisyUI tokens: blocked `text-error`, done `text-success`. So `--color-spur-error` and `--color-spur-success` are defined at `global.css:16-17` but have **no consumer**, while their daisyUI counterparts are used instead — two color families resolving the same semantics. | `status-icons.tsx` vs `apps/web/src/styles/global.css:15-18` |
| E4 | **4 of 6 icons share a circular silhouette** — backlog (dashed circle), active (filled circle), done (circle+check), cancelled (circle+x). Only verifying (eye) and blocked (triangle) break the ring. Removing the text label makes shape the primary channel, and shape is currently weak. | `status-icons.tsx` glyph paths |
| E5 | No tooltip primitive exists. `components/ui/` ships 11 primitives (Badge, Button, Card, Checkbox, Input, Join, Loading, Modal, Select, Textarea, Toggle) — none is a Tooltip, and no `tooltip` usage appears anywhere in `apps/web/src`. | `apps/web/src/components/ui/` |
| E6 | **Parallel status registry.** `taskStatusIcon()` (emoji glyphs) is exported from `@gobing-ai/spur-domain/schema` and used by `KanbanColumn.tsx:31`, `TaskDetail.tsx:1`, and — inside the Features module itself — `FeatureDetail.tsx:523`. The web-local SVG `FEATURE_STATUS_MAP` is a second, unrelated system. | domain pkg vs `status-icons.tsx` |
| E7 | **No collapse chevron exists.** `TreeNode` unconditionally renders children; there is no expand/collapse state. The leading slot is free today, but a future chevron will contend for it. | `FeatureTree.tsx:82-98` |
| E8 | **Tests depend on the status text.** `components.test.tsx:82` asserts `'status: active'`; `:172` asserts icons + accessible labels for all 6 statuses; `:318-319` *deliberately* relies on the tree badge's status text to disambiguate a query from the detail pane's. Removing the text breaks these. | `apps/web/tests/modules/features/components.test.tsx` |

### The accessibility constraint that decides the design

A tooltip cannot be the only channel. The native `title` attribute is not reachable by keyboard and
is announced inconsistently across screen readers; a CSS-only tooltip (daisyUI `data-tip`, **MEDIUM**
confidence — daisyUI 5.0.29 is declared at `apps/web/package.json:24` but is not installed in the
local tree and the docs lookup was unavailable, so the class contract is unverified) is presentational
only and invisible to assistive tech.

So the accessible name must be carried by the markup itself, with any visual tooltip as pure
enhancement. This is what makes the change more than a CSS tweak — and it is why the design below
does not depend on which tooltip mechanism is chosen.

---

## Approaches

### Approach A — Minimal in-place swap

Delete the `<span>{status}</span>`, drop `variant="outline"` for a bare wrapper, move the
`<FeatureStatusIcon>` call above the id span. Keep `title={...}` as the tooltip.

- **Effort:** ~15 lines, one file (plus test fixes).
- **Trade-offs:** Delivers the requested look immediately. But it leaves E2/E3/E4 untouched and makes
  E4 actively harmful — with the text gone, four statuses become near-identical rings at 14px, and
  the only remaining discriminator is color, which is a WCAG 1.4.1 (Use of Color) failure. `title`
  remains keyboard-unreachable. Ships a regression disguised as a polish.
- **Confidence:** HIGH that it works visually; HIGH that it degrades accessibility.

### Approach B — Accessible leading status column *(recommended)*

Scope: the tree only. Five coordinated moves.

1. **Fixed-width leading slot.** A `w-4 shrink-0 flex justify-center` cell as the row's first child,
   before the id. Fixed width (not intrinsic) so icons align optically down the column regardless of
   nesting depth, and so a future chevron (E7) can claim its own adjacent slot without reflow.
2. **Accessible name in the markup.** Promote the dead `label` field (E2) to the accessible name:
   the icon becomes `role="img"` with a `<title>` element and `aria-label={meta.label}`, so the name
   survives independent of any tooltip. Screen readers announce "Verifying", not "verifying".
3. **Silhouette hardening.** Redraw so the six glyphs differ by *shape* first, color second (E4) —
   the ring family needs to separate (e.g. backlog stays a dashed ring, active becomes a filled ring
   with a distinct core, cancelled loses the ring so the ✕ reads on its own). Verified at 14px before
   merge, and readable in greyscale.
4. **Token unification — with a light-theme prerequisite.** Move the two daisyUI holdouts (blocked
   `text-error`, done `text-success`) onto `text-spur-error` / `text-spur-success` (E3) so all six
   statuses resolve through one family. **This cannot be a straight swap:** the `[data-theme="light"]`
   block at `global.css:29-36` overrides only bg/surface/accent/accent-hover/text/text-muted/border —
   the semantic `--color-spur-success/warning/error/info` are declared once in `@theme` and are
   **theme-invariant**, whereas daisyUI's `text-success`/`text-error` re-resolve per theme. Swapping
   without first adding light-theme values for the semantic tokens would trade a token inconsistency
   for a light-mode contrast regression — `#22c55e` / `#ef4444` are tuned for the dark canvas
   (`#0f1117`), not for `#ffffff`. So the prerequisite is: add light-theme overrides for the semantic
   tokens, contrast-check all six against both canvases (≥3:1 for non-text graphical objects, WCAG
   1.4.11), then swap. If that prerequisite is judged out of scope, the correct fallback is to leave
   the split alone and note it — not to swap and hope.
5. **Tooltip as enhancement.** A small presentational wrapper supplies the visual tooltip. If daisyUI's
   `tooltip`/`data-tip` proves available it costs nothing; otherwise a ~20-line CSS wrapper. Either
   way it is additive — remove it and the component is still accessible.

- **Trade-offs:** Larger than the literal request (touches glyph paths and color tokens) and needs the
  four affected tests reworked to query by accessible name rather than status text (E8). It does not
  fix the two-registry split (E6) — `FeatureDetail`'s pill and `taskStatusIcon` stay as they are.
- **Why the tree only:** the tree is a *scanning* surface where the label is redundant across dozens
  of rows; the detail pane is a *reading* surface with exactly one status, where a labelled pill is
  the correct affordance. Divergence here is intentional, not inconsistency.
- **Confidence:** HIGH. Every move is grounded in a verified finding; no new dependency.

### Approach C — Unify the whole status-affordance system

B, plus: extract a `StatusIndicator` primitive into `components/ui/`, converge the web SVG map and the
domain `taskStatusIcon()` emoji registry (E6) behind one source of truth, and roll the treatment
across tree, feature detail, and Task Kanban.

- **Trade-offs:** The only approach that actually retires the parallel registries, and the right
  end-state. But it edits a **domain package** (`@gobing-ai/spur-domain/schema`) consumed by three
  modules, so the blast radius covers Kanban and both detail panes; it forces a decision on whether
  emoji or SVG wins; and it converts a UI-polish request into a cross-module refactor whose risk is
  dominated by surfaces the operator did not ask about.
- **Confidence:** MEDIUM — the payoff is real but the sizing depends on the domain package's consumers
  outside `apps/web`, which were not surveyed.

---

## Recommendation

**Approach B**, with C's registry unification recorded as an explicit follow-up rather than dropped.

B is the smallest change that delivers the requested aesthetic *without* shipping the accessibility
regression that A would. The scope growth over A is not gold-plating: removing the text label is
precisely what promotes shape and color from decoration to sole information channel, so hardening the
silhouettes (3) and unifying the tokens (4) are consequences of the request, not additions to it.

C is deferred because the two-registry split (E6) predates this change and is not made worse by it —
it is a real debt, but paying it down means editing a domain package to satisfy a left-panel polish
request, which inverts the risk/reward.

**Deliberate non-goals:** the Feature detail pane's status pill, the Task Kanban status treatment, and
the `taskStatusIcon()` domain registry all stay as-is.

---

## Design Summary

Replace the trailing icon+text outline `Badge` in the feature tree with a fixed-width **leading status
slot** rendering an icon-only indicator, positioned before the feature id.

The indicator's accessible name comes from `FEATURE_STATUS_MAP[status].label` — a field that already
exists and is currently unread — exposed via `role="img"` + `<title>` + `aria-label` on the SVG, so
the status is announced to screen readers and available to keyboard users without depending on a
tooltip. A visual tooltip is layered on as a presentational enhancement only.

Because removing the text label makes glyph shape the primary information channel, the six icon paths
are hardened so their silhouettes are mutually distinguishable at 14px and in greyscale (satisfying
WCAG 1.4.1 — color must not be the sole discriminator).

Status colors converge on the `--color-spur-*` family, retiring the current 4/2 split with daisyUI.
Because those semantic tokens are theme-invariant today while their daisyUI counterparts re-resolve
per theme, convergence is gated on first adding light-theme values for `--color-spur-success/warning/
error` and contrast-checking all six glyphs against both canvases (≥3:1, WCAG 1.4.11). If that gate
is not met, the split stays and is recorded as debt rather than swapped blind.

The slot is fixed-width so rows stay optically aligned across nesting depths and a future
expand/collapse chevron can be added adjacently without reflow. Scope is the tree only: the feature
detail pane, Task Kanban, and the domain `taskStatusIcon()` registry are untouched. Four existing
tests that assert on the rendered status *text* are reworked to assert on the accessible *name*.

**Follow-up (not this change):** converge `FEATURE_STATUS_MAP` and `taskStatusIcon()` behind a single
status registry and a shared `StatusIndicator` primitive (Approach C).

## `needs_design` signal

```json
{ "needs_design": true }
```

**Rationale:** the change establishes a cross-cutting convention (semantic color-token ownership for
status, and the accessible-name contract for icon-only indicators) and requires an explicit ruling on
registry ownership — B-versus-C is an architecture decision about where status presentation lives, not
an implementation detail. Per the ties-lean-design rule, `true`.

## Spec self-review

- No placeholders, `TODO`, or empty sections.
- No internal contradictions: the tree/detail divergence is stated as intentional with a rationale.
- Scope creep check: moves 3 and 4 are justified as consequences of removing the text label, not
  independent additions; E6 is explicitly deferred.
- Ambiguity check: the tooltip *mechanism* is deliberately left open (daisyUI vs. local wrapper)
  because the accessible-name contract makes the choice non-load-bearing — decompose does not need to
  guess, it needs to verify daisyUI availability at implementation time.
- One unverified claim, flagged inline as MEDIUM: daisyUI 5 `tooltip`/`data-tip` class availability.

## Next steps

1. Create the feature and author R-numbered acceptance criteria.
2. Run `spur feature check --strict`.
3. System design (`needs_design: true`) → **operator approval gate**.
4. Decompose into a task batch; `spur task batch-create`.
