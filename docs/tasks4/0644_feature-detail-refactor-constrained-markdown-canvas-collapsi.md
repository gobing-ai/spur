---
schema_version: 1
name: "Feature detail refactor: constrained markdown canvas, collapsible right metadata drawer, and dynamic action bar hierarchy"
status: todo
template: feature-impl
created_at: 2026-08-23T23:16:46.721Z
updated_at: "2026-08-24T00:14:11.129Z"
feature_id: F84
priority: P2
tags: ["web", "features", "detail"]
dependencies: ["0643"]
---

## 0644. Feature detail refactor: constrained markdown canvas, collapsible right metadata drawer, and dynamic action bar hierarchy

### Background
Refactor `apps/web/src/modules/features/FeatureDetail.tsx` so the markdown body reads at a
comfortable measure, the metadata block becomes a right-side drawer that is folded by default, and
the stage-based action buttons carry a real visual hierarchy instead of one flat row. Covers feature
F84 scenarios R3, R4, R5.

#### Verified premises (checked against the tree at 2026-08-23)

- **Detail root** is `<div className="flex flex-col h-full">` (`FeatureDetail.tsx:457`) — it has no
  positioning context yet, so the drawer needs `relative` added here.
- **Metadata is already collapsible and already folded by default** — `showMetadata` is
  `useState(false)` (`FeatureDetail.tsx:66`) driving a full-width accordion between the header and
  the body (`FeatureDetail.tsx:535-664`). R2 is therefore a **relocation** (accordion → right
  drawer), not new state and not a default-state change.
- **Existing test coupling (must not break).**
  `apps/web/tests/modules/features/components.test.tsx:806-820` finds the metadata trigger by
  *visible text* — `Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Metadata'))`
  — clicks it, and then asserts `Child features (1)` and the
  `Open child feature F1: Child` button. The drawer trigger must therefore keep the visible word
  **Metadata** in its text content, and the drawer contents must stay in the DOM when open.
- **Action bar** is a single flat `statusActions.map(...)` row (`FeatureDetail.tsx:485-506`) whose
  variant logic is three inline branches: `cancel` → `error`, the three create/link actions →
  `outline`, everything else → `accent`. The action vocabulary lives in `feature-actions.ts`
  (`FEATURE_STATUS_ACTIONS`, `FEATURE_ACTION_LABELS`, `FSM_ACTIONS`, `FSM_TRANSITION_TARGET`,
  `AGENT_ACTIONS`, `CREATE_ACTIONS`, `LINK_ACTIONS`) — the tier map belongs there, next to them.
- **Body pane** is `flex-1 flex flex-col overflow-hidden p-3` with an edit/preview toggle row, then
  either `<MDEditor … height="100%">` inside `flex-1 min-h-0` or `<MarkdownBody source={serverBody}/>`
  inside `flex-1 overflow-y-auto` (`FeatureDetail.tsx:666-724`). Both branches need the width cap;
  the `height="100%"` editor means the cap must be applied without removing `flex-1 min-h-0`.
- **Z-index budget in this module:** `FloatingActionProgress` and `NewFeaturePanel` are `z-40`; the
  three `FeatureDetail` confirmation modals are `z-50` (`FeatureDetail.tsx:733`, `765`, `837`). The
  in-pane drawer must sit below those.
- **daisyUI class-leak gate.** `.spur/rules/ui/ui-import-boundary.yaml` (`severity: error`) forbids
  the bare tokens `btn|card|badge|modal|menu|drawer|tabs|dropdown|collapse|tooltip|loading|…` inside
  any `className` outside `components/ui/`. Note `drawer` and `collapse` are both on that list — the
  panel can be *called* a drawer in prose but must not carry those class tokens.
- **0643 handoff:** the shell now supplies `max-w-[1600px]` and a `flex-1 min-w-0 overflow-y-auto`
  detail pane. This task must not add a second page-level width cap.
### Requirements
- [ ] R1. Cap the markdown body at `max-w-4xl mx-auto w-full` in **both** preview (`MarkdownBody`) and edit (`MDEditor`) branches, without breaking the `flex-1 min-h-0` sizing the `height="100%"` editor depends on.

- [ ] R2. Relocate the metadata accordion into a right-side in-pane drawer that stays folded by default, is opened by a docked trigger whose text contains `Metadata`, slides in over the body, and closes on Escape and on the trigger — content (status, dates, tags, file path, child features, linked tasks) carried over verbatim.

- [ ] R3. Give the stage-based action row a three-tier hierarchy driven by one exported map in `feature-actions.ts` — primary forward FSM transitions, secondary create/link/agent actions, and a visually discrete hazard group — with the per-status action membership unchanged.

#### Out of scope
| Not in this task | Owner / reason |
| --- | --- |
| Which actions each status offers (`FEATURE_STATUS_ACTIONS` membership) | Behaviour is frozen; R3 is presentation only |
| FSM transition semantics, `handleAction`, the confirmation modals, agent-channel dispatch | Unrelated to layout; do not touch |
| Shell layout, module header, tree dock | 0643 |
| The floating agent prompt bar | 0645 |
| New metadata fields, task/feature API changes, oRPC contracts | No backend work in F84 |
| Making the drawer resizable, dockable, or persisted | Not requested; `NewFeaturePanel` already owns the off-canvas pattern for creation flows |
### Acceptance Criteria
```gherkin
Feature: Feature detail reading canvas, metadata drawer, and action hierarchy

  Scenario: R3 — Width-constrained Markdown reading and editing area
    Given a feature is selected and its detail view is displayed
    When viewing the body in preview mode or editing in MDEditor
    Then the markdown content is constrained to a readable width container with comfortable padding

  Scenario: R4 — Foldable right-side feature metadata panel
    Given a feature is selected in the detail view
    When the feature details load
    Then the right metadata drawer is folded by default
    And clicking the docked metadata trigger button expands the panel to show frontmatter, linked tasks, and child features

  Scenario: R5 — Refined stage-based dynamic action bar in feature detail
    Given a feature with status "backlog", "active", "verifying", or "blocked"
    When the action bar renders in the feature detail header
    Then primary FSM transition actions are visually prominent
    And secondary creation and link actions are cleanly grouped without clutter
```
### Q&A
- **The metadata trigger keeps a visible `Metadata` label.** An icon-only trigger (`ℹ` / `⚙`) would
  break `components.test.tsx:806-820`, which locates the trigger by `textContent.includes('Metadata')`.
  Decision: the docked trigger is a small labelled button — icon **plus** the word `Metadata` — so the
  existing test passes unmodified and the change stays a relocation. Rejected: icon-only trigger with
  a rewritten test (churns a passing regression guard for cosmetics).
- **Reuse `showMetadata`; do not introduce `isMetadataOpen`.** The state already exists and already
  defaults to folded. Renaming it would touch five call sites for zero behaviour change.
- **The drawer is in-pane (`absolute`), not viewport-`fixed`.** F84 R4 scopes it to the feature
  detail view, and the shell's `max-w-[1600px]` container means a viewport-fixed panel would detach
  from the pane it belongs to. Decision: `absolute inset-y-0 right-0` inside the detail root, which
  gains `relative`. Z-index `z-30` — under `FloatingActionProgress`/`NewFeaturePanel` (`z-40`) and
  the confirmation modals (`z-50`), so no overlay is ever occluded by it.
- **Tier map lives in `feature-actions.ts`, not in JSX.** The three inline `variant` branches in
  `FeatureDetail.tsx:487-491` are already the seam; moving them to a named map next to
  `FEATURE_ACTION_LABELS` keeps one definition site for the action vocabulary and makes the tiering
  unit-testable in `feature-actions.test.ts` without rendering.
- **Hazard actions stay inline, not behind an overflow menu.**
  `docs/design/features-board-layout-refactor.md` §3.5 floats "discrete / overflow"; a popover menu
  is new interaction surface, new dismissal logic, and new tests for a row of at most three buttons.
  Decision: keep them inline, separated by a hairline divider and rendered ghost/error. The overflow
  menu is a later change if the row ever actually overflows.
- **`drawer` and `collapse` are unusable class tokens.** Both are matched by `no-daisyui-class-leak`.
  The panel is composed from plain utilities (`absolute`, `translate-x-*`, `transition-transform`).
### Design
**WHAT.** Three surgical edits inside `FeatureDetail.tsx` plus one new exported map in
`feature-actions.ts`: a width cap on the body, the metadata block moved from a full-width accordion
to an in-pane right panel, and a tiered action row.

**WHY.** F84 R3/R4/R5 — long markdown lines are unreadable on wide monitors, the accordion pushes
the body down the page, and a flat row of up to seven buttons gives the primary transition no
prominence.

**WHERE.** `apps/web/src/modules/features/FeatureDetail.tsx` and
`apps/web/src/modules/features/feature-actions.ts` — **these two files only**.

#### R1 — constrained markdown canvas

Keep the body pane's `flex-1 flex flex-col overflow-hidden p-3` wrapper and the edit/preview toggle
row full width; cap only the content:

```tsx
// edit branch (was: <div className="flex-1 min-h-0" data-testid="body-editor">)
<div className="flex-1 min-h-0 w-full max-w-4xl mx-auto" data-testid="body-editor">
  <MDEditor … height="100%" />
</div>

// preview branch (was: <div className="flex-1 overflow-y-auto" data-testid="body-preview">)
<div className="flex-1 overflow-y-auto" data-testid="body-preview">
  <div className="w-full max-w-4xl mx-auto">
    <MarkdownBody source={serverBody} />
  </div>
</div>
```

The preview cap goes on an **inner** div so the scroll container keeps the full pane width (a capped
scroller would put the scrollbar in the middle of the pane). `data-testid` values are unchanged.

#### R2 — right metadata panel

Detail root becomes `<div className="relative flex flex-col h-full">`. The accordion block at
`FeatureDetail.tsx:535-664` is removed from the vertical flow; its **inner content is moved verbatim**
(status, dates, tags, file path, child features, linked tasks — same markup, same `data-testid`s,
same `navigateToTask` / `onSelectFeature` handlers) into the panel body.

```tsx
{/* trigger — lives in the header action row, after the status actions, before the close button */}
<Button
  variant="ghost"
  size="xs"
  className="text-spur-text-muted"
  onClick={() => setShowMetadata((v) => !v)}
  aria-expanded={showMetadata}
  aria-controls="feature-metadata-panel"
  data-testid="metadata-toggle"
>
  ℹ Metadata
</Button>

{/* panel — last child of the detail root */}
<aside
  id="feature-metadata-panel"
  data-testid="feature-metadata-panel"
  aria-label="Feature metadata"
  className={`absolute inset-y-0 right-0 z-30 w-80 max-w-full overflow-y-auto border-l border-spur-border bg-base-200 shadow-xl transition-transform duration-200 ${
    showMetadata ? 'translate-x-0' : 'translate-x-full'
  }`}
  aria-hidden={!showMetadata}
>
  {showMetadata && <div className="p-3 space-y-3">{/* moved content, verbatim */}</div>}
</aside>
```

Conditional inner render keeps focusable rows (child-feature and linked-task buttons) out of the tab
order while closed — `aria-hidden` alone over focusable children is a keyboard trap. Escape closes:
extend the existing keydown handling pattern, or add a small `useEffect` guarded on `showMetadata`
mirroring the shell's filter-menu dismissal effect (`FeaturesShell.tsx:73-88`).

The literal string `Metadata` inside the trigger is **load-bearing** — see Background and Q&A.

#### R3 — action tier hierarchy

New export in `feature-actions.ts`, placed directly under `FEATURE_ACTION_LABELS`:

```ts
export type FeatureActionTier = 'primary' | 'secondary' | 'hazard';

/** Visual tier per action — presentation only; membership stays in FEATURE_STATUS_ACTIONS. */
export const FEATURE_ACTION_TIER: Record<string, FeatureActionTier> = {
    start: 'primary',
    verify: 'primary',
    complete: 'primary',
    unblock: 'primary',
    brainstorm: 'secondary',
    plan: 'secondary',
    'add-child': 'secondary',
    'add-task': 'secondary',
    'link-task': 'secondary',
    'sync-status': 'secondary',
    block: 'hazard',
    rework: 'hazard',
    cancel: 'hazard',
};
```

Invariant to assert in `feature-actions.test.ts`: every key of `FEATURE_ACTION_LABELS` has a tier,
and every action named in any `FEATURE_STATUS_ACTIONS` list has a tier — so a future action cannot
be added without one.

Rendering: partition `statusActions` (order within a tier preserved from
`FEATURE_STATUS_ACTIONS`) and render three groups left→right — primary, secondary, hazard — with a
hairline `border-l border-spur-border pl-1.5 ml-1.5` opening the hazard group. Variant mapping,
replacing the three inline branches at `FeatureDetail.tsx:487-491`:

| Tier | `Button` props |
| --- | --- |
| `primary` | `variant="primary" size="xs"` |
| `secondary` | `variant="outline" size="xs"` |
| `hazard` | `variant="ghost" size="xs"` + `className="text-spur-error"` |

An action with no tier entry falls back to `secondary` (never dropped from the row). Everything else
about each button — `key`, `onClick={() => handleAction(action)}`, `disabled={actionLoading !== null}`,
`aria-busy`, `aria-label={FEATURE_ACTION_LABELS[action]}`, and the `…` loading text — is unchanged.

#### Frozen names

| Name | Kind | Value |
| --- | --- | --- |
| `FEATURE_ACTION_TIER` | export (`feature-actions.ts`) | `Record<string, FeatureActionTier>` |
| `FeatureActionTier` | exported type | `'primary' \| 'secondary' \| 'hazard'` |
| `feature-metadata-panel` | DOM id + `data-testid` | metadata panel |
| `metadata-toggle` | `data-testid` | metadata trigger |
| `showMetadata` | existing state | kept, still `useState(false)` |
| `body-editor` / `body-preview` / `header-chips` / `status-pill` / `metadata-status` / `action-feedback` | `data-testid` | **preserved verbatim** |

#### Anti-patterns (do not implement)

- Do **not** rename `showMetadata`, change its `false` default, or add a second metadata state.
- Do **not** make the trigger icon-only, and do not rewrite `components.test.tsx:806-820` to match a
  new selector — that test is the regression guard for this move.
- Do **not** add a page-level `max-w-*` to the detail root; 0643 already caps the shell. The cap
  belongs to the markdown content only.
- Do **not** put `max-w-4xl` on the preview *scroll container* — put it on an inner div.
- Do **not** add, remove, or reorder actions in `FEATURE_STATUS_ACTIONS`, and do not change
  `FSM_TRANSITION_TARGET` / `FSM_ACTIONS` / `AGENT_ACTIONS` / `CREATE_ACTIONS` / `LINK_ACTIONS`.
- Do **not** derive the tier from `FSM_ACTIONS` at render time — `block`, `rework`, and `cancel` are
  FSM actions too, so that heuristic mis-tiers exactly the hazards this task is separating.
- Do **not** introduce an overflow/popover menu, a resizable panel, or `localStorage` persistence.
- Do **not** write `drawer`, `collapse`, `card`, `modal`, `badge`, `btn*`, or `tooltip` into any
  `className` — `no-daisyui-class-leak` is `severity: error`.
- Do **not** use `<dialog>` or a focus trap; this panel is a non-modal inspector, and the pane behind
  it stays interactive.

#### Dependency contract

- **From 0643:** the detail pane is `flex-1 min-w-0 overflow-y-auto` inside a `max-w-[1600px]` shell;
  the shell provides no positioning context, so the drawer's `relative` ancestor is this component's
  own root.
- **To 0645:** the agent bar is viewport-`fixed` at `z-30` and horizontally centred; the metadata
  panel is also `z-30` but pane-`absolute` on the right edge — they can visually meet at the bottom
  right. 0645 keeps the collapsed spirit icon at `bottom-6 right-6`, which is acceptable overlap
  with the panel's lower edge; neither may be raised above `z-30`.

#### Verification intent

`apps/web/tests/modules/features/components.test.tsx` (FeatureDetail describe) for the panel and the
capped canvas; `apps/web/tests/modules/features/feature-actions.test.ts` for the tier map invariants.
The two existing metadata-related tests must pass **unmodified**.
### Plan
- [ ] Cap the preview and editor branches at `max-w-4xl mx-auto w-full` — inner div for preview, on the sizing div for the editor — keeping `data-testid` values and `height="100%"` intact (R1)
- [ ] Add `FeatureActionTier` + `FEATURE_ACTION_TIER` to `feature-actions.ts` and cover both invariants (every label has a tier; every action in every status list has a tier) in `feature-actions.test.ts` (R3)
- [ ] Replace the flat action row with the three tier groups, hairline-separated hazard group, and the frozen variant mapping, leaving handlers and aria attributes untouched (R3)
- [ ] Add `relative` to the detail root, add the `ℹ Metadata` trigger to the header action row, and move the metadata content verbatim into the `#feature-metadata-panel` aside with the translate transition and conditional inner render (R2)
- [ ] Wire Escape-to-close for the panel, mirroring the filter-menu dismissal effect in `FeaturesShell.tsx` (R2)
- [ ] Extend `components.test.tsx`: panel is absent from the tab order while folded, opens on the trigger with `aria-expanded` flipping, renders child features and linked tasks, closes on Escape; preview and editor wrappers carry `max-w-4xl`; the primary transition button for each of backlog/active/verifying/blocked renders in the primary tier and hazards in the hazard group (R1–R3)
- [ ] Confirm the two pre-existing metadata tests pass **without edits**, then run `bun run lint`, `bun test apps/web/tests/modules/features/`, and the `no-daisyui-class-leak` rule gate
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
