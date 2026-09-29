---
schema_version: 1
name: Prove per-project module catalog isolation through the in-app project switcher
status: cancelled
template: feature-impl
created_at: 2026-09-29T03:05:22.880Z
updated_at: "2026-09-29T03:19:15.391Z"
feature_id: A8

---

## 0997. Prove per-project module catalog isolation through the in-app project switcher

### Background

A8 R2 states: "Exercise the **existing project-switch navigation** and ensure no previous project's
native state/style/catalog or frame URL leaks into the new origin."

The isolation *property* is proven. The *named mechanism* is not.

`apps/web/tests/modules/composed-board-browser.test.ts` — the composed-path proof added by 0992 —
establishes per-origin isolation by navigating the page directly to the second project's origin
(`browser.navigate`, lines 190/274/331/368) and asserting the second catalog's metadata, content,
stylesheet and frame URL are the only ones present, with no retained state. The Board never performs
the switch itself.

A component test for the control exists (`apps/web/tests/components/ProjectSwitcher.test.tsx`), but it
is not wired to a multi-project catalog fixture, so nothing connects the switch action to a real
per-project catalog.

**Evidence**
- `apps/web/tests/modules/composed-board-browser.test.ts:372` — "a second origin serves the same module
  id with different metadata, content and frame URL" (direct navigation, not the switcher).
- `apps/web/tests/components/ProjectSwitcher.test.tsx` — component-level only.
- 0992 Review residual (P2), carried forward and never closed: "the in-app `ProjectSwitcher` control
  itself is not driven".

**Why it matters**
The switcher is the surface an operator actually uses. A regression in how it resolves or hands off the
target origin (a wrong project id, a stale catalog retained across the switch, a missed reload) would
not fail any current test. The isolation guarantee currently rests on a navigation the Board does not
itself perform.

### Requirements

- [x] R1. [cancelled, not implemented — see Q&A] Drive the real in-app project switcher control in the composed browser proof against a
  server-owned multi-project fixture, so the Board itself performs the project change rather than the
  test navigating on its behalf. Exercise the shipped control; do not add a test-only switch seam or
  weaken the component to make it drivable.
- [x] R2. [cancelled, not implemented — see Q&A] Assert, after switching through the control, that only the switched-to project's catalog,
  module content, stylesheet and frame URL are present, and that no prior-project state is retained
  (no native module in-page state, no leftover injected stylesheet, no stale catalog entry, no stale
  frame URL).
- [x] R3. [cancelled, not implemented — see Q&A] Keep the existing direct-navigation assertions. This task adds the switcher path; it does not
  replace or relax the current proof.
- [x] R4. [cancelled, not implemented — see Q&A] Keep the fixture honest: both project origins must serve the same module id with different
  metadata, content, stylesheet and frame URL, so a leaked catalog or a stale asset fails the proof
  rather than passing quietly.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Project switching uses each project's own module catalog (req: R2; R3)
  Given two project servers serve the same module id with different metadata, content, stylesheet and frame URL
  And the Board has composed the first project's catalog and rendered one of its modules
  When the user selects the second project through the in-app project switcher
  Then the second project's catalog, module content, stylesheet and frame URL are what render
  And no native module state, stylesheet, catalog entry or frame URL from the first project remains
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T03:17:10.652Z

- **Decision (2026-09-28): cancelled — the gap is not real at the browser level.** `ProjectSwitcher.handleSelect`
  (`apps/web/src/components/ProjectSwitcher.tsx`) switches by `window.location.href = http://localhost:<port>/board`
  (or the `/api/projects/start` result URL): a full cross-origin document navigation. No JS heap, module map,
  injected stylesheet or registry survives it by construction, so "stale catalog retained across the switch"
  cannot happen through this control. The isolation property is therefore exactly what the direct-navigation
  proof already asserts (`apps/web/tests/modules/composed-board-browser.test.ts:419-455`), and the control's only
  own logic — list from `/api/projects`, pick the target URL — is covered by
  `apps/web/tests/components/ProjectSwitcher.test.tsx:89-132` (asserts `http://localhost:5678/board`).
- A browser case driven through the switcher would need a mocked `/api/projects` in the test board server, so
  it would add no coverage of the real endpoint either.
- **Reopen condition:** the switcher changes to in-app (client-side) switching — i.e. the Board swaps catalogs
  without a document navigation. Then a switcher-driven browser isolation proof becomes required.
- Out-of-scope note (not filed): the switcher hard-codes `localhost`, so a Board reached via LAN/remote host
  switches to the wrong host. Unrelated to A8 isolation.
- Also corrected on review: the Background's "A8 R2" is 0992 R2 (feature scenario is A8 R12), and the cited
  second-origin case is at line 420, not 372.

### Design

**Fix direction**

- Extend `apps/web/tests/modules/composed-board-browser.test.ts` with a switcher-driven case beside the
  existing direct-navigation one, reusing its fixtures and assertions.
- The switcher needs projects to list. Extend the proof server helper
  (`apps/web/tests/test-helpers/board-server.ts`) or add a sibling helper that exposes the real project
  list the switcher reads, backed by the two existing composed trees
  (`apps/web/tests/fixtures/composed-board/`, `apps/web/tests/fixtures/composed-board-alt/`). Confirm
  what the shipped switcher actually consumes before inventing a fixture shape.
- Reuse the isolation assertions already written for the second-origin case so the two paths assert the
  same property rather than drifting apart.

**Constraints**

- No production change should be required for this task. If driving the switcher needs one, stop and
  report: that is a different task about the switcher's testability, not about A8's isolation proof.
- Keep everything inside `apps/web`; the composed proof must stay a real-browser proof over CDP.

**Out of scope**

- The changed-selection restart lifecycle (filed separately).
- Any new switcher UI or behavior.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T03:17:10.963Z backlog → cancelled (system)

