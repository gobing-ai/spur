---
template: issue
schema_version: 1
name: "Prototype Features detail action-group IA and visual hierarchy"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0351", "0353", "0352", "0354"]
created_at: "2026-07-27T17:49:52.422Z"
updated_at: "2026-07-27T20:06:30.943Z"
---

## 0355. Prototype Features detail action-group IA and visual hierarchy

### Background
Wayfinder ticket for map F81. Type: **prototype** (`wayfinder:prototype`).

Once membership (0351) and confirmation (0353) are decided, produce a cheap, concrete IA + visual hierarchy for the Features detail action group (primary row, overflow, destructive styling, loading/disabled states) for operator reaction before full implementation.
### Requirements
R1. Produce a prototype artifact (markdown wire + optional lightweight TSX sketch or design notes) covering primary actions, overflow, confirm affordance, async-in-flight state, and empty/done/cancelled statuses.

R2. Address usability: grouping, priority of Sync/Check vs FSM, truncation on narrow panel, keyboard reachability notes.

R3. Do not ship production UI; artifact is for reaction and will feed later `/sp:dev-plan` implementation tasks.

R4. Depends on 0351 (membership) and 0353 (confirm). May assume 0352/0354 placeholders for in-flight/feedback chrome.
### Acceptance Criteria
```gherkin
Feature: Prototype Features detail action-group IA and visual hierarchy

  Scenario: Prototype artifact produced
    Given the membership matrix from 0351 and the confirm matrix from 0353
    When prototype ticket 0355 is resolved
    Then Solution holds a prototype artifact (markdown wire + optional TSX sketch / design notes) covering primary actions, overflow, confirm affordance, async-in-flight state, and empty/done/cancelled statuses

  Scenario: Usability concerns addressed
    Given the panel must group actions and remain usable on narrow widths
    When the prototype is recorded
    Then Solution addresses grouping, priority of Sync/Check vs FSM, truncation on narrow panel, and keyboard reachability notes

  Scenario: Prototype only — not production
    Given 0355 is a prototype ticket feeding later /sp:dev-plan implementation
    When it completes
    Then Solution records the prototype only and does not ship production UI

  Scenario: Dependency assumptions stated
    Given 0351 (membership) and 0353 (confirm) are resolved, and 0352/0354 may be placeholders
    When the prototype is built
    Then Solution states it assumes 0352/0354 placeholders for in-flight/feedback chrome
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Prototype artifact (0355) — 2026-07-27.** Wayfinder `prototype` for map F81 (Features detail action group). Inputs: 0351 membership matrix (`done`), 0352 async-runner model (`done`), 0353 confirm matrix (`done`), 0354 observability contract (`done`). **Scope: IA + visual hierarchy prototype for operator reaction only** (R3) — no production UI shipped by this ticket; this artifact feeds later `/sp:dev-plan` implementation tasks. Assumes 0352/0354 placeholders for in-flight/feedback chrome (R4).

This Solution addresses: R1 (artifact covering primary/overflow/confirm/in-flight/empty-done-cancelled), R2 (grouping + Sync-vs-FSM priority + narrow-panel truncation + keyboard reachability), R3 (prototype only), R4 (dependency-assumption statement). It binds 0351's membership × 0353's confirm-level into a single visual contract, and slots in 0352/0354 chrome as named placeholders so the implementing ticket has one surface to build.

---

**R1 — Prototype artifact**

The artifact has two parts: (A) a **markdown wire** of the per-status action group layout, and (B) a **lightweight TSX sketch** of the button-group component shape (not wired to data; for IA review). Both reuse the design tokens already in the tree (`text-spur-text`, `text-spur-text-muted`, `text-spur-text-faint`, `bg-spur-accent`, `text-spur-accent`, `border-spur-border`, `bg-spur-surface`, and the status colors `text-spur-success`/`text-spur-warning`/`text-spur-error`) so the prototype reads as a plausible extension of the current `FeatureDetail.tsx:412-442` button row, not an alien skin.

**A. Markdown wire — per-status action group**

The action group has three zones, top-to-bottom in the detail header (right of the title/chips stack, below the status pill row at `FeatureDetail.tsx:390-410`):

```
┌─────────────────────────────────────────────────────────────┐
│  [PRIMARY ROW]   ……   [OVERFLOW ⋮]   [STATUS CHIP]   [✕]    │  ← zone 1+2+3
│  ──────────────────────────────────────────────────────────  │
│  [IN-FLIGHT STRIP]  (only when an action from this group    │  ← zone 4 (0352/0354)
│                      is queued/running/retrying/failed)      │
└─────────────────────────────────────────────────────────────┘
```

- **Zone 1 — PRIMARY ROW.** Visible buttons for this status's `primary` ops (0351). Rendered left-to-right in **FSM-first, then composition, then sync** order (see R2 priority). Each button carries its 0353 confirm level implicitly via its click handler (`none` fires; `soft`/`hard` opens a modal).
- **Zone 2 — OVERFLOW (`⋮` / kebab).** Houses this status's `overflow` ops (0351) plus, by default, any newly discovered op (0351 R3). Opens a dropdown menu (existing daisyUI dropdown pattern, used elsewhere in the shell). Destructive overflow items render with `text-spur-error`.
- **Zone 3 — STATUS CHIP (0354 R2 minimum-viable surface).** Small textual state indicator driven by SSE after a `FeatureActionResponse` returns: `queued` / `running` / `retrying` / `done` / `failed`. Idle (no recent action) = absent. Lives next to the close button so it never collides with the action buttons themselves.
- **Zone 4 — IN-FLIGHT STRIP (placeholder, 0352/0354).** A thin banner below the row that appears only while ≥1 action from this group is non-terminal. Shows the action label + spinner + elapsed. On terminal failure, the strip turns into the R4 failure surface (error styling) for ~5s or until dismissed; the persistent failure path is the global error toast (0354 R2). **This zone is a placeholder shape** — its exact copy/animation is owned by the implementing ticket consuming 0354.

#### Per-status primary/overflow composition (binds 0351 × 0353)

Legend: **P**=primary (zone 1), **OF**=overflow (zone 2), **—**=never. Confirm level from 0353 in parens: (n)=none, (s)=soft, (h)=hard. Terminal statuses (done/cancelled) get no FSM buttons (0351).

**backlog**
```
PRIMARY:  [Start (n)]   [Add child (n)]   [Add task (n)]
OVERFLOW: Link task (n) · Sync pull (s) · Derive (n) · Check (n) · Advance (s) · Refresh (n) · Move (h) · Unlink task (h) · Brainstorm (s) · Plan (s) · Cancel (h)
CHIP:     idle
```

**active**
```
PRIMARY:  [Verify (s)]   [Block (n)]   [Add child (n)]   [Add task (n)]   [Link task (n)]
OVERFLOW: Sync pull (s) · Derive (n) · Check (n) · Advance (s) · Refresh (n) · Move (h) · Unlink task (h) · Brainstorm (s) · Plan (s) · Cancel (h)
CHIP:     idle
```

**verifying**
```
PRIMARY:  [Complete (s)]   [Rework (h)]   [Check (n)]   [Sync pull (s)]   [Add child (n)]   [Add task (n)]   [Link task (n)]
OVERFLOW: Derive (n) · Advance (s) · Refresh (n) · Move (h) · Unlink task (h) · Cancel (h)
CHIP:     idle
```

**blocked**
```
PRIMARY:  [Unblock (n)]   [Add child (n)]   [Add task (n)]
OVERFLOW: Link task (n) · Sync pull (s) · Derive (n) · Check (n) · Advance (s) · Refresh (n) · Move (h) · Unlink task (h) · Cancel (h)
CHIP:     idle
```

**done** (terminal)
```
PRIMARY:  (none — no FSM buttons; growth ops suppressed per 0351)
OVERFLOW: Refresh (n) · Derive (n) · Sync pull (s) · Check (n) · Move (h)
CHIP:     idle
```
Rationale: done is frozen for FSM + composition (0351 R1), but read-only maintenance (refresh/derive/check) and re-parent (move, behind hard confirm) remain useful for housekeeping. Cancel/rework/verify/start are illegal here (FSM).

**cancelled** (terminal)
```
PRIMARY:  (none)
OVERFLOW: (none — reopen is CLI-only today, 0351 R3)
CHIP:     idle
```

#### Confirm affordance (binds 0353 R1/R2)

Three confirm primitives, all reusing existing modal chrome from `FeatureDetail.tsx:607-776`:

| Level | Trigger | Modal shape | Reuse |
|---|---|---|---|
| **none** | click → `POST /features/{id}/action` immediately | (no modal) | current `handleAction` path |
| **soft** | click → modal with risk line + `Cancel`/`Confirm` (Cancel default-focused) | small modal, no typed input | extend `actionModal` chrome (`:640-707`); channel selector stays for brainstorm/plan |
| **hard** | click → modal with risk line + **typed-input gate** + disabled-until-match `Confirm` | modal with `Input`; exact-match gate (feature name / target id / WBS) except `rework` (free-text reason, min length) | extend `showCancelModal` chrome (`:607-637`) into a typed-input variant |

Destructive-op copy is pre-decided in 0353 R2 (cancel/rework/move/unlink-task/sync-push); the implementing ticket transcribes those strings verbatim. Default focus is always the non-destructive button (0353 R2 copy rules).

#### Async-in-flight state (binds 0352 R2 + 0354 R1)

After `POST /features/{id}/action` returns `{ runId, action, status: 'queued' }` (0352 R2 contract), the clicked button enters its in-flight lifecycle and Zone 3/4 activate:

| Lifecycle state (0354 R1) | Button visual | Zone 3 chip | Zone 4 strip |
|---|---|---|---|
| confirmed (POST in flight) | disabled, label → `…` | `queued` (muted) | shown, spinner |
| queued | disabled | `queued` (muted) | shown, spinner |
| running | disabled | `running` (accent) | shown, spinner |
| retrying | disabled | `retrying` (warning) | shown, "retrying…" |
| succeeded | re-enabled; chip → `done` (success) for ~3s then clears | clears → idle | hides; detail refreshes via `feature.*` SSE (existing `detailRefreshKey` bump, `FeaturesShell.tsx:99-100`) |
| failed | re-enabled; chip → `failed` (error) | `failed` (error) until next action or dismiss | strip → error styling; global error toast fires (0354 R2) |
| cancelled (reserved, 0354 R1) | re-enabled | clears → idle | hides |

**Placeholder assumption (R4):** the exact chip/strip visual treatment and the `queue.job.started` derivation (currently inferred client-side, 0354 R1) are owned by the implementing ticket consuming 0354. The prototype fixes the *state space* and *placement* (zones 3+4), not the animation.

#### Empty / done / cancelled statuses (R1 explicit)

- **Empty (no feature selected):** current `Select a feature to view details` placeholder (`FeatureDetail.tsx:181-183`) is unchanged — the action group does not render.
- **done:** no FSM buttons, no composition buttons (growth suppressed). Overflow holds only read-only maintenance + move. Zone 3/4 idle. The header status pill (`:391-396`) already shows `done` in its status color; no extra "frozen" affordance is added.
- **cancelled:** no buttons at all (primary and overflow both empty). A single muted line under the header — *"Reopen via `spur feature update <id> active` on the CLI."* — replaces the action row, so the operator is not left staring at an empty strip wondering why. (This is the only status where the action group is replaced by a hint rather than hidden.)

**B. TSX sketch (IA review, not production)**

A sketch of the button-group component shape, using existing primitives (`Button`, `Badge`) and tokens. **Not wired to data, not imported anywhere, not built by this ticket** — it exists to make the IA concrete for operator reaction (R3). The implementing ticket will reshape it against the real `FeatureActionResponse` (0352) and SSE stream (0354).

```tsx
// SKETCH ONLY — prototype artifact for 0355, not shipped. IA review.
// Reuses tokens: text-spur-text, text-spur-text-muted, text-spur-error,
// bg-spur-accent, text-spur-accent, border-spur-border, bg-spur-surface,
// text-spur-success, text-spur-warning.

import { Button, Badge } from '../../../ui';     // existing primitives
import { FEATURE_ACTION_LABELS } from './feature-actions';

// 0351 membership: status -> { primary: Op[], overflow: Op[] }
// 0353 confirm:    Op -> 'none' | 'soft' | 'hard'
// 0352/0354:       actionLifecycle: Op -> 'idle'|'queued'|'running'|'retrying'|'done'|'failed'
type Op = keyof typeof FEATURE_ACTION_LABELS;
type ConfirmLevel = 'none' | 'soft' | 'hard';
type Lifecycle = 'idle' | 'queued' | 'running' | 'retrying' | 'done' | 'failed';

interface ActionGroupProps {
    status: FeatureStatus;
    primary: Op[];                              // from 0351, pre-filtered to this status
    overflow: Op[];                             // from 0351, pre-filtered to this status
    confirmOf: (op: Op) => ConfirmLevel;        // from 0353
    lifecycleOf: (op: Op) => Lifecycle;         // from 0352/0354 SSE
    onAction: (op: Op) => void;                 // opens confirm modal (soft/hard) or dispatches (none)
}

export function FeatureActionGroupSketch({
    status, primary, overflow, confirmOf, lifecycleOf, onAction,
}: ActionGroupProps) {
    // cancelled: replace row with reopen hint (0355 R1)
    if (status === 'cancelled') {
        return (
            <p className="text-xs text-spur-text-muted italic px-3 py-2">
                Reopen via <code className="font-mono text-spur-accent">spur feature update &#123;id&#125; active</code> on the CLI.
            </p>
        );
    }

    const isTerminal = status === 'done';
    const chip = anyActive(lifecycleOf, [...primary, ...overflow])
        ? aggregateChip(lifecycleOf, [...primary, ...overflow])
        : null;

    return (
        <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-spur-border shrink-0">
            {/* Zones 1 + 2 + 3 */}
            <div className="flex flex-wrap items-center justify-end gap-1">
                {/* Zone 1 — PRIMARY (FSM-first, then composition, then sync — see R2) */}
                {primary.map((op) => (
                    <ActionSketch
                        key={op}
                        op={op}
                        confirm={confirmOf(op)}
                        lifecycle={lifecycleOf(op)}
                        variant={variantFor(op)}
                        onClick={() => onAction(op)}
                    />
                ))}

                {/* Zone 2 — OVERFLOW */}
                {overflow.length > 0 && (
                    <OverflowMenu ops={overflow} confirmOf={confirmOf} lifecycleOf={lifecycleOf} onAction={onAction} />
                )}

                {/* Zone 3 — STATUS CHIP (0354 R2) */}
                {chip && (
                    <Badge
                        variant="outline"
                        size="xs"
                        className={chipClass(chip)}
                        data-testid="action-status-chip"
                    >
                        {chip}
                    </Badge>
                )}
            </div>

            {/* Zone 4 — IN-FLIGHT STRIP (placeholder, 0352/0354) */}
            {chip && chip !== 'done' && chip !== 'failed' && (
                <div className="flex items-center gap-2 text-[11px] text-spur-text-muted">
                    <Spinner className="text-spur-accent" />
                    <span>Action {chip}…</span>
                </div>
            )}
            {chip === 'failed' && (
                <div className="flex items-center gap-2 text-[11px] text-spur-error">
                    <span>Action failed — see toast.</span>
                </div>
            )}
        </div>
    );
}

// Variant mapping: destructive -> error; composition -> outline; FSM/sync -> accent.
// Matches current tiering at FeatureDetail.tsx:414-417, extended for rework/move/unlink.
function variantFor(op: Op): 'accent' | 'error' | 'outline' {
    if (['cancel', 'rework', 'move', 'unlink-task'].includes(op)) return 'error';
    if (['add-child', 'add-task', 'link-task'].includes(op)) return 'outline';
    return 'accent';
}
```

The sketch deliberately stops at the component boundary — it does not model the SSE subscription, the `runId` ref (0354 R3: exposed but not required for correctness), or the confirm-modal bodies (0353 R2 owns the copy). Those are the implementing ticket's job.

---

**R2 — Usability concerns**

**Grouping**

Three groups, ordered for muscle memory:

1. **FSM transitions** (start / verify / complete / rework / block / unblock / cancel) — always first in the primary row when present. These are the status-shaping actions; the operator's eye lands here first.
2. **Composition** (add-child / add-task / link-task) — second. Growth actions cluster so "add a thing" is always in the same spot.
3. **Sync / validation / maintenance** (sync pull / check / advance / refresh / derive / move / unlink-task / brainstorm / plan) — last in primary (when promoted, e.g. sync pull on active/verifying, check on verifying), else in overflow.

Overflow is **flat** (not sub-grouped) for ship — a kebab with a single list. Sub-menus ("Maintenance…", "Agent…") are a deferred enhancement; the flat list is short enough per status (max ~11 items on backlog) that grouping inside the kebab is premature. Newly discovered ops land at the bottom of the flat overflow (0351 R3 default).

**Priority of Sync/Check vs FSM**

**FSM wins the primary row; Sync/Check are secondary even when promoted.** Concrete ordering on the busiest status (verifying):

```
[Complete (s)] [Rework (h)] [Check (n)] [Sync pull (s)] [Add child] [Add task] [Link task] | ⋮
```

`Complete`/`Rework` (the terminal-deciding FSM ops) lead; `Check` and `Sync pull` follow because they *inform* the FSM decision (you check, then you complete). This matches the operator's likely sequence and keeps the highest-stakes button (Complete) at the leftmost-primary position where it is hardest to mis-click. On active, `Verify` leads for the same reason — it is the status-advancing FSM op, and Sync/Check (when used) feed it.

`Sync pull` is primary on active/verifying (0351) but **sits after Check** because Check is cheaper (sync exception, 0352 R3) and is the more frequent pre-verify probe. Sync pull is the heavier recompute and is a soft-confirm (0353) — placing it after Check lets the operator reach the lighter probe first.

**Truncation on narrow panel**

The detail panel is resizable (`FeatureDetail.tsx` uses `ResizeHandle`) with a 36rem min and 80vw max (`KanbanBoard.tsx:313`). On narrow widths the current flat `statusActions.map` already wraps (`flex-wrap`, `:412`). The prototype preserves wrap but adds two narrow-width behaviors:

1. **Primary row collapses to a max of 3 visible buttons** below ~28rem panel width; the rest demote into the overflow kebab for that render only (visual demotion, not a membership change — 0351 stays the SSOT). The 3 kept are the **FSM leaders** (e.g. Complete/Rework on verifying; Verify/Block on active; Start on backlog). Composition and sync demote first.
2. **Button labels shorten** under ~24rem: `Complete` → `✓`, `Rework` → `↩`, `Cancel` → `✕`, with the full label in `title`/`aria-label`. FSM glyphs are status-unambiguous; composition buttons keep text ("+ Child", "+ Task") because glyphs would be ambiguous. This is the only place the prototype introduces icon-only buttons — text labels remain the default at every other width.

The kebab (`⋮`) is always visible (never truncates away) so overflow is reachable at every width. The status chip (zone 3) truncates last — it is the smallest element and carries the least-redundant information.

**Keyboard reachability**

- **Tab order:** primary row (left→right, DOM order = visual order) → overflow kebab → status chip (if present) → close (`✕`). This matches the current single-row tab order (`:412-441`); the prototype adds only the kebab and chip as new tab stops.
- **Enter/Space** on a button fires the same click handler (confirm modal or dispatch). On the kebab, Enter/Space opens the menu; Arrow Down moves focus into the first item; Escape closes and returns focus to the kebab (standard daisyUI dropdown behavior, already in the tree).
- **Soft/hard confirm modals:** initial focus is the **non-destructive** button (`Cancel`/close) per 0353 R2. Tab cycles `Cancel → Confirm → (typed input for hard)`. Escape closes as Cancel. The destructive `Confirm` is **never** the focused element on open — this is the single most important keyboard-safety rule and is repeated in the modal IA.
- **Overflow menu items** are reachable by arrow keys (not just Tab) once open, matching the System Events prefix-pill pattern (`SystemEventsTab.tsx:595-617` uses a fieldset of buttons; the overflow menu should use `role="menu"` with `arrow` navigation for parity with kebab conventions). This is a parity note for the implementing ticket, not a prototype decision.
- **No keyboard shortcut layer is added.** The action group is mouse+keyboard-reachable via Tab; a full shortcut layer (e.g. `g s` to start) is out of scope for F81 and would conflict with the Board's existing `g`/`f`/`t` module-switching keys.

---

**R3 — Prototype only, not production**

This ticket ships **no production UI**. Specifically:

- No change to `FeatureDetail.tsx`, `feature-actions.ts`, `FeaturesShell.tsx`, or any `*.tsx`/`*.ts`/`*.js`/`*.jsx`.
- The TSX sketch above is illustrative — it is not imported, not compiled into the app, and not tested. It exists only to make the IA concrete for operator reaction.
- The artifact feeds later `/sp:dev-plan` implementation tasks under F81, which will: (a) implement `FeatureService.fulfillAction` + worker consumer (0352 R4/R5), (b) widen the client SSE filter (`FeaturesShell.tsx:94`, 0354 R1), (c) add the status chip + global error toast (0354 R2), (d) build the confirm modals from 0353 R2 copy, (e) reshape the button row per this prototype's zone layout.

Operator reaction is the gate. If the operator rejects the zone layout, the grouping priority, or the narrow-width truncation rules, the implementing tickets adjust against this artifact — the artifact is the single point of revision.

---

**R4 — Dependency assumptions stated**

This prototype assumes the following placeholders from 0352 and 0354 (both `done` decisions, but their *implementation* is deferred to later F81 tickets):

| Placeholder | Source | What the prototype assumes | What it does NOT assume |
|---|---|---|---|
| `FeatureActionResponse { runId, action, status: 'queued' }` | 0352 R2 | the post-click contract shape is fixed; the chip/strip lifecycle keys off `status` transitions | the worker consumer is registered (0352 R4 — implementing ticket) |
| All-async-except-`check` | 0352 R3 | `check` fires inline (no chip, no strip); every other op goes through the queue | the `sync` job is atomic (0354 R4 contract requirement on the implementing ticket) |
| Confirm-before-enqueue | 0353 R3 | the modal runs in the click handler before `POST`; the typed payload rides with enqueue | the modal primitives are built (0353 R2 copy → implementing ticket) |
| Status chip + global error toast | 0354 R2 | zones 3+4 exist and are driven by SSE after `FeatureActionResponse` returns | the `api-error` dead-letter listener is mounted (0354 R2 — implementing ticket) |
| `queue.job.*` already streamed | 0354 R1 | the server needs no widening; only the client filter (`FeaturesShell.tsx:94`) widens | the client filter change is made (implementing ticket) |
| `cancelled` is reserved | 0354 R1 | the chip/strip never show a cancelled state for ship; cancel surfaces only as chip→idle | a cancel affordance exists (none today; future) |

The prototype is **forward-compatible** with 0352/0354's named enhancements (a future `queue.job.started` event changes "running" from inferred to observed with no zone change; a future cancel affordance adds a chip state without a layout change) — the zone layout is stable across those enhancements.

---

**Handoff**

- **Solution holds the prototype** (this section) — the IA + visual-hierarchy SSOT for the F81 action-group build-out.
- **Implementing tickets** (to be planned via `/sp:dev-plan` under F81) consume: 0351 (membership), 0352 (runner + contract), 0353 (confirm copy), 0354 (observability), and this artifact (visual contract). They should not re-derive grouping, priority, or truncation rules — those live here.
- **Map Decisions gist (one line):** *Features detail action group = three-zone header (primary FSM-first row / overflow kebab / status chip) + in-flight strip placeholder; per-status composition from 0351×0353; cancelled shows a reopen hint instead of an empty row; narrow panel demotes non-FSM buttons into overflow and shortens FSM labels to glyphs.*
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Prototype artifact covers primary/overflow/confirm/async-in-flight/empty/done/cancelled |
| R2 | MET | Usability: grouping, Sync/Check priority, truncation, keyboard reachability addressed |
| R3 | MET | No production UI shipped; artifact is for reaction |
| R4 | MET | Depends on 0351 (done) + 0353 (done); assumes 0352/0354 placeholders |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review (2026-07-27) — three-dimensional: functional traceability + SECUA + architecture.**

**Scope:** docs-only prototype ticket (wayfinder:prototype). Diff = `docs/tasks3/0355_…md` only (319+/5− to `

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed; no P1–P3 findings |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T20:01:53.593Z todo → done (system)
- 2026-07-27T20:02:34.589Z done → wip (system)
- 2026-07-27T20:06:30.676Z wip → testing (system)
- 2026-07-27T20:06:30.943Z testing → done (system)
