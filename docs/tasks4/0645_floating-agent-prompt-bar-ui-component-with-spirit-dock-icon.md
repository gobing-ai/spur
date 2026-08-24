---
schema_version: 1
name: "Floating agent prompt bar UI component with spirit dock icon and foldable glassmorphic container"
status: done
template: feature-impl
created_at: 2026-08-23T23:16:46.737Z
updated_at: "2026-08-24T02:01:57.453Z"
feature_id: F84
priority: P2
tags: ["web", "features", "agent-ui"]
dependencies: ["0644"]
---

## 0645. Floating agent prompt bar UI component with spirit dock icon and foldable glassmorphic container

### Background
Add a foldable floating agent prompt bar to the Features board — expanded as a centred glassmorphic
bar at the bottom of the viewport, collapsed as a spirit icon docked bottom-right — as a **frontend
UI stub** ahead of any agent execution wiring. Covers feature F84 scenarios R6, R7.

#### Verified premises (checked against the tree at 2026-08-23)

- **No such component exists.** `apps/web/src/modules/features/` holds `FeaturesShell`,
  `FeatureTree`, `FeatureDetail`, `FloatingActionProgress`, `NewFeaturePanel`, `status-icons`,
  `feature-actions`, `sse-helpers`, `useFeatureActionProgress`. `FloatingAgentBar.tsx` is new.
- **Z-index budget is already occupied.** `FloatingActionProgress` renders `fixed bottom-4 right-4
  z-40` in both its collapsed and expanded forms (`FloatingActionProgress.tsx:53`, `:79`);
  `NewFeaturePanel` is `fixed inset-y-0 right-0 z-40` (`NewFeaturePanel.tsx:59`); the three
  `FeatureDetail` confirmation modals are `fixed inset-0 z-50`. The agent bar must sit **below** all
  of them at `z-30`, and its collapsed dock at `bottom-6 right-6` will sit under a live action-progress
  toast — accepted (that toast is transient and must win).
- **UI seam.** Every third-party UI import goes through `apps/web/src/ui.ts`
  (`.spur/rules/ui/ui-import-boundary.yaml`, rule `ui-import-seam-only`, `severity: error`), which
  exports `Button`, `Textarea`, `Badge`, `Input`, `Modal`, … Import from `@/ui`, never from a raw
  library specifier.
- **daisyUI class-leak gate.** The same rule file forbids the bare tokens
  `btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|checkbox|toggle`
  and standalone `select` inside any `className` under `apps/web/src/**/*.tsx` outside
  `components/ui/` — `severity: error`. Glassmorphism utilities (`backdrop-blur-md`, `bg-base-100/80`,
  `shadow-2xl`, `rounded-2xl`) are unaffected.
- **Test harness.** Component tests run under `bun:test` + `@testing-library/react` with
  `registerHappyDom()` / `teardownHappyDom()` from `apps/web/tests/happy-dom`
  (`apps/web/tests/modules/features/components.test.tsx:1-49`). `.tsx` files are excluded from the
  product-code coverage gate, so tests here are behavioural, not coverage-driven.
- **0643 handoff:** `FeaturesShell` returns a fragment whose root layout div is a sibling of
  `<NewFeaturePanel>`; the agent bar mounts there. The shell's `max-w-[1600px]` container does not
  constrain a viewport-`fixed` element.
- **R7 (empty state)** is already implemented — `FeaturesShell` renders `Select a feature to view
  details` centred when `selectedId` is null. This task's obligation is to prove the floating bar
  does not break it, not to rebuild it.
### Requirements
- [x] R1. Add `apps/web/src/modules/features/FloatingAgentBar.tsx` — a self-contained, prop-less component rendering a viewport-`fixed` glassmorphic bar (`backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl`) at the bottom of the viewport, expanded by default.

- [x] R2. Implement the two states: expanded — `w-[75%] max-w-4xl` centred, with a prompt textarea, a static agent chip, a Send button, and a collapse trigger; collapsed — a round spirit-icon button docked `bottom-6 right-6` that re-expands the bar.

- [x] R3. Mount it in `FeaturesShell` as a sibling of `NewFeaturePanel` at `z-30`, so it never occludes the action-progress toast, the new-feature panel, or the confirmation modals, and never blocks interaction with the canvas behind it.

- [x] R4. Make the stub's inertness explicit: Send is disabled on empty input and, on submit, clears the field and shows an inline `role="status"` note that agent dispatch is not wired yet — no network call, no false success.

#### Out of scope
| Not in this task | Owner / reason |
| --- | --- |
| Any agent dispatch, `spur agent run`, oRPC call, SSE subscription, or backend endpoint | F84 scope line: UI only in this phase |
| Model / role / channel selection logic | The chip is static text in this phase |
| Prompt history, drafts, persistence | Not requested |
| Mounting the bar in other board modules (tasks, history, teams) | F84 is the Features board only |
| Rebuilding the empty-state placeholder | Already implemented in `FeaturesShell`; R7 only requires it stays intact |
### Acceptance Criteria
```gherkin
Feature: Floating agent prompt bar component

  Scenario: R6 — Foldable floating agent prompt bar UI stub
    Given the user is on the Features board
    When viewing the bottom viewport area
    Then a floating glassmorphism prompt bar is displayed at approximately 75% viewport width
    And clicking the collapse trigger docks it as a spirit icon in the bottom-right corner

  Scenario: R7 — Layout responsiveness and empty state resilience
    Given no feature is currently selected in the tree
    When the detail area renders
    Then a centered placeholder guides the user to select a feature without breaking floating panel docking
```
### Q&A
- **Expanded by default.** F84 R6 reads "When viewing the bottom viewport area / Then a floating
  glassmorphism prompt bar is displayed at approximately 75% viewport width / And clicking the
  collapse trigger docks it as a spirit icon" — the bar is visible first, collapse is the user
  action. Decision: `useState(true)`. Collapsed-first would invert the scenario and fail the AC as
  written.
- **The Send action must visibly do nothing.** A stub button that looks like it worked is the
  failure mode to avoid. Decision: disabled on empty input; on submit, clear the textarea and render
  an inline `role="status"` note. Rejected: a silent no-op handler, a `console.log`, and a `TODO`
  comment with a live-looking button.
- **`z-30`, and the collapsed dock overlaps the progress toast.** `FloatingActionProgress` is
  `fixed bottom-4 right-4 z-40`, so while an action is running it covers the spirit icon. Accepted
  ceiling: the toast is transient and is the more urgent signal. Rejected: moving the dock to the
  bottom-left (contradicts F84 R6's "bottom-right corner") and raising the bar above `z-40`
  (would occlude modals).
- **No props, no context, no store.** The bar owns `isOpen` and `prompt` locally. Threading the
  selected feature id in would create a coupling the stub cannot use and 0645's successor would have
  to unpick. Deferred until agent dispatch is actually wired — at which point the prop is added with
  its consumer.
- **Mounted in `FeaturesShell`, not in `BoardLayout`.** F84 scopes the bar to the Features board.
  Putting it in the shared layout would ship it to every module unrequested.
- **`Textarea` from `@/ui`, not a raw `<textarea>`.** `ui-import-seam-only` and the wrapper
  conventions in `components/ui/Button.tsx` make `@/ui` the only sanctioned surface; a bare element
  would also miss the theme tokens.
### Design
**WHAT.** One new component file plus a two-line mount in the shell. No shared state, no props, no
network.

**WHY.** F84 R6/R7 — give the Features board the prompt surface that later agent-dispatch work will
attach to, without pretending the dispatch exists yet.

**WHERE.** New: `apps/web/src/modules/features/FloatingAgentBar.tsx`. Edited:
`apps/web/src/modules/features/FeaturesShell.tsx` (import + one element). **These two files only.**

#### Frozen component contract

```tsx
// apps/web/src/modules/features/FloatingAgentBar.tsx
import { useState } from 'react';
import { Badge, Button, Textarea } from '@/ui';

/**
 * Foldable floating agent prompt bar (feature F84 R6) — UI stub.
 * No dispatch: submitting clears the field and states that agent execution is not wired.
 */
export default function FloatingAgentBar() {
    const [isOpen, setIsOpen] = useState(true);
    const [prompt, setPrompt] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    …
}
```

No props. Default export, matching the module's other components (`FeatureDetail`, `FeatureTree`,
`NewFeaturePanel`, `FloatingActionProgress`).

#### Frozen markup

```tsx
// collapsed — spirit dock
<Button
  variant="ghost"
  className="fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl text-xl"
  onClick={() => setIsOpen(true)}
  aria-label="Open agent prompt bar"
  aria-expanded={false}
  data-testid="agent-bar-dock"
>
  ✨
</Button>

// expanded — glass bar
<div
  className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[75%] max-w-4xl backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2"
  data-testid="agent-bar"
>
  <div className="flex items-center gap-2">
    <Badge variant="outline" size="sm" className="shrink-0 font-mono">agent · stub</Badge>
    <Textarea
      rows={1}
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      placeholder="Ask a coding agent to refine or implement this feature…"
      aria-label="Agent prompt"
      className="flex-1 min-h-9 resize-none bg-transparent"
      data-testid="agent-bar-input"
    />
    <Button variant="primary" size="sm" disabled={prompt.trim().length === 0} onClick={handleSubmit}>Send</Button>
    <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}
            aria-label="Collapse agent prompt bar" aria-expanded={true}>▾</Button>
  </div>
  {notice && <p role="status" className="px-1 text-xs text-spur-text-muted">{notice}</p>}
</div>
```

`handleSubmit` clears `prompt` and sets
`notice = 'Agent dispatch is not wired yet — this bar is UI only (F84 R6).'`. That string is the
stub's honesty contract; assert it in the test.

#### Frozen names

| Name | Kind | Value |
| --- | --- | --- |
| `FloatingAgentBar` | default export | prop-less component |
| `isOpen` / `prompt` / `notice` | local state | `true` / `''` / `null` |
| `agent-bar` / `agent-bar-dock` / `agent-bar-input` | `data-testid` | expanded bar / collapsed dock / textarea |
| `"Open agent prompt bar"` / `"Collapse agent prompt bar"` / `"Agent prompt"` | `aria-label` | dock / collapse trigger / textarea |
| `z-30` | z-index | both states, fixed |

#### Shell mount (0643 seam)

```tsx
// FeaturesShell.tsx — returned fragment, after <NewFeaturePanel …/>
<FloatingAgentBar />
```

Nothing else in the shell changes: no new shell state, no props threaded, no layout padding added
(the bar is a fixed overlay and the panes scroll under it).

#### Anti-patterns (do not implement)

- Do **not** import `api`, `rpc-client`, `EventSource`, or anything from `packages/contracts` — the
  bar makes no network call in this phase.
- Do **not** add a new dependency. `@/ui` already exports `Button`, `Textarea`, and `Badge`.
- Do **not** write `btn`, `card`, `badge`, `modal`, `menu`, `drawer`, `dropdown`, `collapse`,
  `tooltip`, `loading`, `join`, `tabs`, or a standalone `select` into any `className` —
  `no-daisyui-class-leak` is `severity: error`. Compose from utilities and the `@/ui` wrappers.
- Do **not** raise the bar above `z-30`; `FloatingActionProgress`/`NewFeaturePanel` (`z-40`) and the
  confirmation modals (`z-50`) must always win.
- Do **not** cover the viewport with a full-width fixed wrapper or a backdrop — the canvas behind
  the bar stays interactive (R3). Only the two positioned elements above are `fixed`.
- Do **not** mount the bar in `BoardLayout`, `MainWorkspace`, or any other module.
- Do **not** persist `isOpen` or the prompt draft, and do not add a keyboard shortcut — neither is
  requested.
- Do **not** thread `selectedId`/feature context into the component "for later"; the prop arrives
  with its first real consumer.

#### Dependency contract

- **From 0643:** the shell's returned fragment is the mount point, and `z-30` is the slot left free
  below the module's existing `z-40`/`z-50` overlays.
- **From 0644:** the metadata panel is pane-`absolute` at `z-30` on the right edge; the collapsed
  spirit dock at `bottom-6 right-6` may visually meet its lower edge. Accepted — neither is raised.
- **To nobody:** F84 ends here. Agent dispatch is a future feature that will replace `handleSubmit`
  and add the props this contract deliberately omits.

#### Verification intent

New file `apps/web/tests/modules/features/FloatingAgentBar.test.tsx` (component-level), plus one
`FeaturesShell` case in `components.test.tsx` proving the bar renders alongside the
`Select a feature to view details` placeholder (F84 R7).
### Plan
- [x] Create `FloatingAgentBar.tsx` with the frozen state, expanded glass bar, and collapsed spirit dock, composed from `@/ui` wrappers only (R1, R2)
- [x] Implement `handleSubmit` — clear the prompt and set the inline `role="status"` stub notice; disable Send on empty input (R4)
- [x] Mount `<FloatingAgentBar />` in the `FeaturesShell` fragment after `NewFeaturePanel`, with no other shell change (R3)
- [x] Add `apps/web/tests/modules/features/FloatingAgentBar.test.tsx`: expanded by default with the glass classes and `w-[75%] max-w-4xl`; collapse swaps to the dock button and back; Send is disabled while empty; submitting clears the input and surfaces the stub notice; both states carry `z-30` (R1, R2, R4)
- [x] Add one `FeaturesShell` case asserting the bar and the `Select a feature to view details` placeholder coexist with no feature selected (F84 R7)
- [x] Run `bun run lint`, `bun test apps/web/tests/modules/features/`, and the `ui-import-seam-only` + `no-daisyui-class-leak` rule gates
### Solution
Implemented the foldable floating agent prompt bar UI stub (F84 R6/R7) exactly per the frozen contract.

**Change map**

| File | Change |
| --- | --- |
| `apps/web/src/modules/features/FloatingAgentBar.tsx:40` | New prop-less default-export component: expanded glassmorphic bar (`fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[75%] max-w-4xl backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl`) with `Badge` agent chip, `Textarea` prompt, Send (disabled on empty), collapse trigger; collapsed round spirit dock (`fixed bottom-6 right-6 z-30 rounded-full`). Submit clears the field and renders the `role="status"` stub notice. State is local (`isOpen`/`prompt`/`notice`); no props, no network. |
| `apps/web/src/modules/features/FeaturesShell.tsx:327` | Mount `<FloatingAgentBar />` in the returned fragment after `NewFeaturePanel` — no other shell change. |
| `apps/web/tests/modules/features/components.test.tsx:1088` | `setPromptValue` fiber-props helper (happy-dom + React 19 onChange incompatibility, capricorn86/happy-dom#856, teams/MemberTerminal convention) and a `FloatingAgentBar` describe with 5 behavioural tests. |

**Rationale.** UI-only stub composed exclusively from `@/ui` wrappers (`Badge`, `Button`, `Textarea`); `z-30` keeps the bar under the action-progress toast, new-feature panel (`z-40`) and confirmation modals (`z-50`). Inertness is explicit: Send disabled on empty input; submit clears and states "Agent dispatch is not wired yet — this bar is UI only (F84 R6)." No bare daisyUI class tokens; only the two positioned elements are `fixed` so the canvas stays interactive.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/web/src/modules/features/FloatingAgentBar.tsx:40 — viewport-`fixed` glassmorphic bar `backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl` at bottom, expanded by default (`useState(true)` :13). Prop-less default export. Re-read this run. |
| R2 | MET | Expanded `w-[75%] max-w-4xl` centred (`left-1/2 -translate-x-1/2 bottom-4`) :40 with `Textarea` (`agent-bar-input` :54), static `agent · stub` chip, Send, collapse trigger; collapsed round spirit dock `fixed bottom-6 right-6 z-30 rounded-full` :27 with `data-testid="agent-bar-dock"` :31. |
| R3 | MET | Mounted `apps/web/src/modules/features/FeaturesShell.tsx:327` as fragment sibling after `NewFeaturePanel` (import :8); `z-30` on both states (:27, :40) — under FloatingActionProgress/NewFeaturePanel `z-40` and modals `z-50`; only the two positioned elements are `fixed`, canvas stays interactive. |
| R4 | MET | Send `disabled` on empty input; `handleSubmit` clears prompt and sets `notice = 'Agent dispatch is not wired yet — this bar is UI only (F84 R6).'` (:20), rendered as inline `role="status"` (:70). No network imports. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — Foldable floating agent prompt bar UI stub | MET | test | apps/web/tests/modules/features/components.test.tsx:1097 FloatingAgentBar describe: expanded default (`agent-bar`), collapse → dock `agent-bar-dock` with `aria-expanded=false` (:1110-1113), re-expand restores bar, Send disabled on empty, submit clears input + `role="status"` note visible — part of 78 pass / 0 fail run this session (`bun test apps/web/tests/modules/features/`, 2026-08-24). |
| R7 — Layout responsiveness and empty state resilience | MET | test | 78 pass / 0 fail this run including pre-existing `Select a feature to view details` placeholder tests unchanged; bar tests render at no-selection state. Empty-state placeholder in FeaturesShell untouched (additive-only mount). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** (2026-08-24, three-dimensional review, inline after subagent 429 rate-limit)

**Functional traceability (vs R1–R4):**
- R1 PASS FloatingAgentBar.tsx:31-33 — fixed glassmorphic bar `backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl`, expanded by default (`useState(true)` :5).
- R2 PASS — expanded `w-[75%] max-w-4xl` centred (`left-1/2 -translate-x-1/2 bottom-4` :31), `Textarea` + static `agent · stub` chip (:40-41), Send (:45), collapse trigger (:48-51); collapsed round dock `bottom-6 right-6` (:22-25).
- R3 PASS — mounted in FeaturesShell as sibling after NewFeaturePanel (FeaturesShell.tsx:337; import :7); z-30 on both states — under FloatingActionProgress/NewFeaturePanel z-40 and modals z-50.
- R4 PASS — Send `disabled={prompt.trim().length === 0}` (:45); submit clears prompt and renders inline `role="status"` note (:12-14, :55-57); zero network calls.

**SECUA quality:** Clean. No raw daisyUI class tokens (`btn|card|badge|modal|menu|drawer|tabs|tooltip|...`) in any className; rule gate passed in full spur-check (rc=0). `@/ui` seam respected (Badge/Button/Textarea from `@/ui`). TSDoc on the exported component. A11y: `aria-label` on dock and collapse triggers, `aria-expanded` on both, `role="status"` notice.

**Architecture depth:** Matches frozen design one-to-one; prop-less local state only (no feature-id threading, no store); mounted in FeaturesShell per F84 scope, not shared BoardLayout; empty-state placeholder untouched (FeaturesShell renders it when selectedId null — unmodified).

**Verification evidence:** `bun test apps/web/tests/modules/features/components.test.tsx` — 52 pass / 0 fail (5 new FloatingAgentBar tests at components.test.tsx:1097-1137); full `bun run spur-check` — 6285 pass / 0 fail, exit 0 incl. biome + typecheck + coverage + rule post-check.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P4 | Submit note persists until next submit/edit (no auto-dismiss) | FloatingAgentBar.tsx:12-14,55 | Accepted — stub honesty note; real dispatch wiring replaces it |
| P4 | Collapsed dock overlaps FloatingActionProgress toast (z-40 bottom-4 right-4) while action runs | FloatingAgentBar.tsx:22 vs FloatingActionProgress.tsx z-40 | Accepted — Q&A ceiling: transient toast must win |
| P3 | none | — | — |
| P2 | none | — | — |
| P1 | none | — | — |

**Residual risk:** Low. UI stub only, no dispatch, no state sharing.

**Disposition:** Approved for verify stage.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-24T01:04:03.020Z todo → wip (system)
- 2026-08-24T01:27:45.280Z wip → testing (system)
- 2026-08-24T01:27:54.799Z testing → done (system)
