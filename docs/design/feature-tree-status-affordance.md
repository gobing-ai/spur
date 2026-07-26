# Feature-tree status affordance — design

**Feature:** R2 · **Authority:** ADR-034 · **Date:** 2026-07-25
**Discovery:** `docs/plans/2026-07-25-feature-tree-status-icon-brainstorm.md`

Mechanism detail for making the FEATURES tree status indicator icon-only. ADR-034 owns the
decisions; this file owns the shape.

## 1. Row anatomy

Today (`apps/web/src/modules/features/FeatureTree.tsx:70-81`):

```
[ id ][ name ......................... ][ ◯ verifying ]   ← outline Badge, trailing
```

Target:

```
[ ◍ ][ id ][ name ................................... ]   ← fixed slot, leading
 └─ w-4, centered, accessible name "Verifying"
```

The indicator becomes the row button's first child, ahead of the id `<span>`. Its wrapper is
`w-4 shrink-0 flex items-center justify-center` — **fixed** width, not intrinsic, so:

- icons form a straight column regardless of glyph width;
- the column does not shift when statuses differ down the tree;
- a future expand/collapse chevron takes an adjacent fixed slot without reflowing the row
  (no chevron exists today — `FeatureTree.tsx:82-98` always renders children).

Depth indentation stays on the button's `paddingLeft` (`FeatureTree.tsx:76`), so the indicator
indents *with* its row and remains optically aligned within each depth level.

`StatusBadge` is deleted. The `Badge` import from `@/ui` goes with it if unused elsewhere in the file.

## 2. Accessible-name contract

Per ADR-034 (3), the name lives in the markup, not in a tooltip.

- `FEATURE_STATUS_MAP[status].label` — the field already exists in `StatusMeta` and is currently
  read by nothing — becomes the name source. Today's badge renders the raw lowercase `status`
  instead, so screen readers announce "verifying"; after this change they announce "Verifying".
- The SVG gains `role="img"` and `aria-label={meta.label}`, and drops `aria-hidden="true"` (it is no
  longer decorative — it *is* the status).
- The visual tooltip is a separate, additive concern. **Resolved (task 0336):** daisyUI's CSS-only
  `tooltip` / `data-tip` proved available and is used, wrapped in a typed `Tooltip` primitive at
  `apps/web/src/components/ui/Tooltip.tsx` exported from `@/ui`, so no component writes
  `className="tooltip …"` by hand. Because daisyUI renders the tip via `content: attr(data-tip)`,
  it contributes **no** accessible name — the inner `role="img"` SVG names itself, per (2) above.
  Callers compose layout utilities on the wrapper (`flex! w-4 shrink-0`) to override daisyUI's
  default `display:inline-block`. Deleting the tooltip leaves the accessible name intact — asserted
  by `components.test.tsx:313`.

## 3. Vocabulary import

Per ADR-034 (1), `status-icons.tsx` stops re-declaring the vocabulary:

```ts
// remove: export const FEATURE_STATUSES = ['backlog', …] as const;
import { FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema';
```

Precedent: `KanbanBoard.tsx:2` already imports `TASK_STATUSES` the same way. Re-export from
`status-icons.tsx` if existing importers depend on the local symbol. The emoji
`FEATURE_STATUS_ICONS` in the domain is **not** consumed here — SVG is the Board's encoding.

## 4. Glyph silhouettes

The current six put four statuses on a circle: backlog (dashed ring), active (filled disc), done
(ring + check), cancelled (ring + ✕). With the text label gone this leaves color doing most of the
discriminating — a WCAG 1.4.1 problem.

Requirement, not a prescribed drawing: **the six silhouettes must be mutually distinguishable at
14px with color removed.** The ring family must break up — e.g. by giving cancelled and done
distinct outer contours rather than a shared ring, and by separating backlog's dashed ring from
active's filled disc by more than fill alone. Verification is a greyscale render at 14px, checked
pairwise across all six (AC R6).

`verifying` (eye) and `blocked` (triangle) already read distinctly and need no change.

## 5. Color tokens

Current split (`status-icons.tsx`):

| Status | Class today | Family |
|---|---|---|
| backlog | `text-spur-text-muted` | Spur |
| active | `text-spur-accent` | Spur |
| verifying | `text-spur-warning` | Spur |
| blocked | `text-error` | daisyUI |
| done | `text-success` | daisyUI |
| cancelled | `text-spur-text-muted opacity-60` | Spur |

**Resolved (tasks 0335 + 0338).** All six now resolve through `text-spur-*`:

| Status | Class (final) | Dark | Light |
|---|---|---|---|
| backlog | `text-spur-text-muted` | `#94a3b8` 7.36:1 | `#64748b` 4.76:1 |
| active | `text-spur-accent` | `#6366f1` 4.22:1 | `#4f46e5` 6.29:1 |
| verifying | `text-spur-warning` | `#f59e0b` 8.79:1 | `#b45309` 5.02:1 |
| blocked | `text-spur-error` | `#ef4444` 5.01:1 | `#dc2626` 4.83:1 |
| done | `text-spur-success` | `#22c55e` 8.28:1 | `#15803d` 5.02:1 |
| cancelled | `text-spur-text-faint` | `#5f6978` 3.40:1 | `#7c8699` 3.67:1 |

12/12 ≥ 3:1 (WCAG 1.4.11), independently re-verified 2026-07-26.

`cancelled` was the blocker: as `text-spur-text-muted opacity-60` it measured **2.30:1** on the
light canvas, which froze the swap under 0335's R4 gate. 0338 resolved it with a dedicated
`--color-spur-text-faint` token carrying per-theme values (lever 2 of the three the 0335 review
named), rather than an opacity blend or a global `text-muted` darkening — so no ripple to other
muted text. The two previously orphaned tokens (`--color-spur-error` / `--color-spur-success`) now
have consumers.

**Prerequisite that gated this (ADR-034 (2)) — now satisfied.** `[data-theme="light"]` originally
overrode only bg/surface/accent/accent-hover/text/text-muted/border, leaving the semantic tokens
theme-invariant and tuned for the dark canvas (`#0f1117`), while the daisyUI classes they replaced
re-resolve per theme. A straight swap would have traded a token inconsistency for a light-mode
contrast regression, so the work was ordered: (1) add light-theme values for the semantic tokens,
(2) contrast-check all six glyphs on both canvases, (3) only then swap. 0335 did (1) and (2) and
correctly stopped at the R4 gate when `cancelled` failed; 0338 cleared the blocker and completed (3).
`[data-theme="light"]` now carries `--color-spur-success/warning/error` (`global.css:49-51`) and
`--color-spur-text-faint` (`:44`).

## 6. Test impact

`apps/web/tests/modules/features/components.test.tsx` — four touch points:

| Line | Current dependency | Change |
|---|---|---|
| `:82` | asserts `'status: active'` | assert accessible name |
| `:139` | "renders … status badges" | rename + assert leading slot |
| `:172` | icons + accessible labels, all 6 | assert `label`-derived names |
| `:318-319` | *deliberately* uses tree badge status text to disambiguate the tree row from the detail pane | re-disambiguate by role/test-id, not status text |

`:318-319` is the load-bearing one — its comment states the tree status is chosen to differ from the
detail's so a status query matches exactly one node. Once the tree has no status text, that
disambiguation strategy is gone and the query must key on something else.

New coverage: leading-slot position (R1), absence of status text and badge chrome (R2), name source
(R3), all-six mapping (R4), greyscale distinguishability (R6), fixed-width alignment across depths
(R7), unknown-status fallback (R12).

## 7. Out of scope

`FeatureDetail.tsx` status pill · Task Kanban · the domain emoji registries · a shared
`StatusIndicator` primitive in `components/ui/` · tree expand/collapse · the header status filter
(task 0326, already done).
