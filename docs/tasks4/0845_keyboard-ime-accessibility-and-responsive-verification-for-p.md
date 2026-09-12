---
schema_version: 1
name: Keyboard, IME, accessibility, and responsive verification for Projects
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.546Z
updated_at: "2026-09-12T06:03:02.328Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0841", "0842", "0844"]
---

## 0845. Keyboard, IME, accessibility, and responsive verification for Projects

### Background

The prototype already pins the interaction contract with runnable evidence: 19 happy-dom tests and
200 assertions in `apps/web/tests/prototypes/g6-projects.test.ts`, with Chrome 153 checks at 390 px
and 1440 px (`docs/reports/g6-projects-prototype.md`, scenarios KB-1…KB-4, ST-1, LB-1).

Those tests run against `docs/prototypes/g6-projects/index.html`, not production. This task carries
the contract across to the real module so the guarantees survive the port instead of being re-derived
by hand.

The IME case is the one that silently breaks in production: Enter that ends a composition must not
submit.

### Requirements

- **R1** — Enter submits, Shift+Enter inserts a newline, and an Enter that ends an IME composition
  submits nothing.
- **R2** — Escape closes member detail and restores focus to its opener; tabs are keyboard-navigable
  with `aria-selected`.
- **R3** — Status is never color-alone: icon plus text, with live-region announcements for state
  changes.
- **R4** — Verified at 390 px and 1440 px with no horizontal overflow.
- **R5** — The prototype's KB-1…KB-4, ST-1, and LB-1 scenarios are carried to production tests, not
  left behind in the prototype suite.

### Acceptance Criteria

```gherkin
Feature: Keyboard, IME, accessibility, and responsive verification for Projects

  @core
  Scenario: R7 — Keyboard, IME, and accessibility hold
    Given the composer has focus with an IME active
    When Enter ends the composition
    Then nothing is submitted
    And Shift+Enter inserts a newline, Escape restores focus to its opener, and status uses icon plus text rather than color alone

  @core
  Scenario: Layout holds at both widths
    Given the Projects module at 390 px and at 1440 px
    When each view is rendered
    Then no horizontal overflow occurs

  @core
  Scenario: State changes are announced
    Given a request whose state changes after submission
    When the new state renders
    Then it is announced in a live region
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T06:03:02.328Z

**Can happy-dom prove "no horizontal overflow at 390 px"? — CLOSED: no, and the requirement is split
accordingly.** happy-dom has no layout engine, so `scrollWidth` / `clientWidth` / computed box
geometry are not produced and a geometric assertion there passes vacuously. The repo's existing
responsive test agrees by construction — `apps/web/tests/components/ResponsiveAndTheme.test.tsx`
asserts data attributes and labels, never geometry. R4 is therefore a structural half in happy-dom
(no oversized `min-width`, per-element `overflow-x` containers, wrapping rows) plus a geometric half
in a real browser. Detail: Design § Premise correction.

**How is the browser half run without adding a dependency? — CLOSED: an untracked runner using the
operator-local Playwright.** `/Users/robin/node_modules/playwright` and
`~/Library/Caches/ms-playwright` are already present on this machine, and the prototype's own evidence
used exactly this arrangement (`docs/reports/g6-projects-prototype.md:87`). The runner lives at
`.spur/run/g63-projects/browser-check.mjs`, which is gitignored, so `package.json` gains nothing and
no tracked script is created — `docs/design/harness-surface-governance.md` is not engaged. The
prototype's copy under `.spur/run/` has already been cleaned, so the runner is written fresh rather
than reused.

**Is the prototype suite deleted once its scenarios are ported? — CLOSED: kept.** R5 requires the
scenarios to exist in production tests; it does not require the prototype's to stop existing. The
prototype document is the artifact Robin asked to review before the detailed interactions are built
(G63 Notes), and its 19-test suite is what keeps that document honest. Deleting it would destroy the
review artifact to satisfy a requirement that never asked for the deletion.

**Where does the live region live, given `BoardLayout` is off-limits? — CLOSED: inside
`GlobalAgentBar`, in both branches.** 0840's anti-patterns permit exactly one `BoardLayout` edit
(mounting the providers), and `GlobalAgentBar` is already mounted globally by `BoardLayout` on every
route — so putting the region inside the bar gives every-route coverage with no new mount point. It is
rendered in the folded dock branch as well as the open branch, so a receipt that changes while the bar
is collapsed is still announced.

**Is the prototype's visible live-region twin ported? — CLOSED: no.** `#g6-live-visual`
(`docs/prototypes/g6-projects/index.html:136`) existed so a reviewer reading the prototype could see
what a screen reader would hear. Production already renders the receipt strip visibly, so the hidden
`role="status"` region alone is the production equivalent; porting the twin would duplicate the
visible receipt in a second place that can disagree with it.

**Which composition signal is authoritative? — CLOSED: both.** `isComposing` is the standard signal
and the one happy-dom honours; `keyCode === 229` is the legacy signal some IMEs still emit on the
composition-ending Enter. Checking only one is the defect R1 names, so `shouldSubmit` checks both and
the test suite exercises each independently.

**Deferred — OS IME candidate windows, non-Chrome browsers, and assistive-technology speech.** The
prototype report already scopes these as compatibility surfaces that were not exercised
(`docs/reports/g6-projects-prototype.md:78`, `:131`). This task inherits that scope: Chromium
composition is driven through CDP `Input.imeSetComposition`, which is real composition input but not
an OS candidate window. Owner: Robin, if a broader compatibility matrix is ever required.

### Design

**WHAT.** Port the prototype's interaction contract to production as three test files plus two small
production additions — a polite live region inside `GlobalAgentBar` and the composer's key handler —
and re-create the browser evidence at 390 px and 1440 px against the real module.

**WHY this is a real task and not "write some tests".** Two of the five requirements cannot be
satisfied by assertions alone. R1's IME case needs a key handler that consults `isComposing` before
it ever calls submit — the production composer has no key handler at all today
(`apps/web/src/components/GlobalAgentBar.tsx` submits only from the Send button's `onClick`). R3's
announcements need a live region that exists on every route. Both are built here, because both are
the contract this task verifies.

**Premise correction — happy-dom cannot prove R4.** happy-dom has no layout engine: `scrollWidth`,
`clientWidth`, and computed box geometry are not produced, so "no horizontal overflow at 390 px" is
unassertable there. The repo's own precedent agrees — `apps/web/tests/components/ResponsiveAndTheme.test.tsx`
asserts `data-mobile-sidebar-open` and label presence, never geometry. R4 therefore splits in two, and
the split is the design, not a shortcut:

- **Structural, in happy-dom:** no element carries a `min-width` wider than 390 px; every table, code
  block, and terminal pane sits inside its own `overflow-x` container; the roster and task rows use
  wrapping flex/grid rather than a fixed track count.
- **Geometric, in a real browser:** `document.documentElement.scrollWidth <= innerWidth` at both
  widths, per view, with zero page errors.

The browser runner is ephemeral and **untracked**: `.spur/run/g63-projects/browser-check.mjs`,
importing the operator-local Playwright already present at `/Users/robin/node_modules/playwright`
with its Chrome from `~/Library/Caches/ms-playwright`. This is the same arrangement the prototype
evidence used (`docs/reports/g6-projects-prototype.md:87`) — **no** project dependency is added and
**no** tracked script is created, so neither `package.json` nor the harness-surface governance in
`docs/design/harness-surface-governance.md` is touched. `.spur/run/` is gitignored and the prototype's
copy has already been cleaned, so the runner is written fresh here rather than reused.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/web/src/components/GlobalAgentBar.tsx` | composer `onKeyDown`; polite live region in both branches |
| `apps/web/tests/modules/projects/keyboard.test.tsx` (new) | KB-1…KB-4 |
| `apps/web/tests/modules/projects/a11y.test.tsx` (new) | ST-1 — status vocabulary, tabs, focus restore |
| `apps/web/tests/modules/projects/responsive.test.tsx` (new) | LB-1 structural half |
| `.spur/run/g63-projects/browser-check.mjs` (untracked) | LB-1 geometric half |
| `docs/reports/g6-projects-prototype.md` | append the production browser receipt beside the prototype's |

**Frozen names.**

```ts
// GlobalAgentBar.tsx
const COMPOSER_SUBMIT_KEY = 'Enter';
const IME_KEYCODE = 229;               // legacy composition signal; checked alongside isComposing
function shouldSubmit(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean;
```

Test attribute added here: `data-agent-bar-live` on the live region. Everything else asserted by this
task is already frozen by its owner — `data-receipt-state` (0844), `data-projects-shell` /
`data-projects-header` / `data-projects-tab` / `data-projects-state` (0840), `data-roster-entry` /
`data-roster-declared` / `data-roster-observed` / `data-roster-issue` / `data-member-detail` (0842),
`data-work-section` (0843), and `data-g6="composer|open-member|task-chip|use-task"`. This task adds no
other attribute; if an assertion needs one, it belongs to the owning task, not here.

**Composer key contract (R1).**

```ts
shouldSubmit(e) =
    e.key === COMPOSER_SUBMIT_KEY &&
    !e.shiftKey &&
    !e.nativeEvent.isComposing &&
    e.nativeEvent.keyCode !== IME_KEYCODE;
```

Both composition signals are checked. `isComposing` is the standard one and is what happy-dom's
`KeyboardEvent` honours; `keyCode === 229` is the legacy signal some IMEs still emit on the
composition-ending Enter, and checking only one of the two is the exact defect R1 names. On a true
`shouldSubmit`, `preventDefault()` runs before submit so the textarea never also inserts a newline;
on false, the event is left alone so Shift+Enter inserts the newline **natively** — no manual
splice of the value, which would desynchronise the cursor and the draft revision.

Send-button submit and Enter submit call the same function (0844's `handleSubmit`); there is one
submit path, not two.

**Live region (R3).** One visually-hidden `role="status" aria-live="polite"` node with
`data-agent-bar-live`, rendered in **both** `GlobalAgentBar` branches — the folded dock and the open
bar — so a receipt that changes while the bar is collapsed is still announced. It carries the
`RECEIPT_LABELS[state].label` text of the most recent receipt transition plus its available action,
which is what makes the announcement actionable rather than a bare state word. The visible badge keeps
icon + text; the announcement is the same words, not a second vocabulary.

The prototype's twin-node arrangement (`#g6-live` hidden plus `#g6-live-visual` visible,
`docs/prototypes/g6-projects/index.html:135-136`) is **not** ported: the visible twin existed so a
reviewer reading the prototype could see what a screen reader would hear. Production has the visible
receipt strip already, so the hidden region alone is the production equivalent.

**Scenario port table (R5).** Each prototype scenario maps to exactly one production test; the
prototype suite (`apps/web/tests/prototypes/g6-projects.test.ts`, 19 tests) is **kept**, not deleted —
it guards the prototype document Robin asked to review, and deleting it would destroy that artifact.

| Prototype | Production test | Asserts against |
| --- | --- | --- |
| KB-1 Enter submits | `keyboard.test.tsx` | one POST; `data-receipt-state="pending"` |
| KB-2 Shift+Enter newline | `keyboard.test.tsx` | no POST; `preventDefault` not called |
| KB-3 IME Enter never submits | `keyboard.test.tsx` | no POST for `isComposing`, and again for `keyCode: 229` |
| KB-4 Escape restores focus | `a11y.test.tsx` | `document.activeElement` is the `data-g6="open-member"` card (0842) |
| ST-1 honest status labels | `a11y.test.tsx` | every `RequestReceiptState` renders icon + label + action (0844) |
| LB-1 layout at 390/1440 | `responsive.test.tsx` + browser runner | structural rules, then `scrollWidth <= innerWidth` |

Tab keyboard navigation and `aria-selected` (R2's second half) are asserted against 0840's frozen
tablist contract in `a11y.test.tsx`.

**Anti-patterns — do not implement.**

- Do not assert layout geometry in happy-dom; it produces no layout. A `scrollWidth` assertion there
  passes vacuously and is worse than no test.
- Do not add Playwright, jsdom, or any browser driver to `package.json`, and do not create a tracked
  script for the browser check.
- Do not delete or rewrite `apps/web/tests/prototypes/g6-projects.test.ts` or the prototype document.
- Do not check only `isComposing` or only `keyCode === 229`; R1 needs both.
- Do not manually insert a newline on Shift+Enter; let the textarea do it.
- Do not add a second submit path for Enter — reuse 0844's `handleSubmit`.
- Do not make the member-detail pane a focus trap; 0842 closed that as a pane with focus restore.
- Do not invent new `data-*` attributes for surfaces another task owns; assert the frozen ones.
- Do not announce state changes by re-rendering the whole receipt strip into an `aria-live="assertive"`
  region; polite is correct and assertive would interrupt the operator mid-typing.
- Do not claim OS-level IME candidate windows, mobile keyboards, or assistive-technology speech as
  verified; the prototype report already scopes those as untested compatibility surfaces and this task
  inherits that scope honestly.

**Handoff.** G64's route retirement (0849) removes Workspace / Inbox / Teams; none of the tests here
reference those routes, so they survive that removal unchanged.

### Plan

1. Add `shouldSubmit`, `COMPOSER_SUBMIT_KEY`, and `IME_KEYCODE` to
   `apps/web/src/components/GlobalAgentBar.tsx`, and wire `onKeyDown` on the `agent-bar-input`
   textarea to call `preventDefault()` then 0844's `handleSubmit` only when `shouldSubmit` is true. (R1)
2. Add the visually-hidden `role="status" aria-live="polite"` node with `data-agent-bar-live` to
   **both** return branches of `GlobalAgentBar`, carrying the latest receipt's label plus its
   available action from 0844's `RECEIPT_LABELS`. (R3)
3. Add `apps/web/tests/modules/projects/keyboard.test.tsx`: Enter on an empty composer submits
   nothing; Shift+Enter submits nothing and does not `preventDefault`; Enter with
   `isComposing: true` submits nothing; Enter with `keyCode: 229` submits nothing; plain Enter posts
   exactly once and renders `data-receipt-state="pending"`. Dispatch events with the prototype's
   helper shape (`new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true,
   shiftKey, isComposing })`, `apps/web/tests/prototypes/g6-projects.test.ts:91-101`). (R1, R5)
4. Add `apps/web/tests/modules/projects/a11y.test.tsx`: the tablist matches 0840's contract
   (`role="tablist"`, per-tab `role="tab"`, `aria-selected`, `aria-controls`/`id` pairing) and arrow
   keys move the active tab; opening a member from a `data-g6="open-member"` card and pressing Escape
   restores `document.activeElement` to that card (0842); every `RequestReceiptState` in
   `RECEIPT_LABELS` renders a non-empty icon **and** label **and** action, so no state is
   colour-only; a receipt transition writes into `data-agent-bar-live`. (R2, R3, R5)
5. Add `apps/web/tests/modules/projects/responsive.test.tsx`: no rendered element declares a
   `min-width` above 390 px; the terminal pane, the task table, and any code block each sit inside an
   element with `overflow-x`; roster and work rows use wrapping containers. Reuse the
   `setFetchForTesting` + `MemoryRouter` rig from
   `apps/web/tests/components/ResponsiveAndTheme.test.tsx:20-33`. (R4, R5)
6. Write `.spur/run/g63-projects/browser-check.mjs` (untracked): launch the operator-local Playwright
   Chrome, visit `/board/projects/{conversation,agents,work}` at 390×900 and 1440×900, assert
   `document.documentElement.scrollWidth <= window.innerWidth` and zero page errors, drive Enter /
   Shift+Enter / CDP `Input.imeSetComposition` / tab arrows / Escape, and write
   `.spur/run/g63-projects/browser-results.json` plus per-view screenshots. (R1, R2, R4)
7. Run `cd apps/web && bun test tests/modules/projects` and the browser runner; append the production
   receipt — Chrome version, both viewports, pass counts, and the untested compatibility surfaces
   (OS IME candidate UI, other browsers, AT speech) — to
   `docs/reports/g6-projects-prototype.md` beside the prototype's existing evidence. (R4, R5)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Evidence to carry forward: `apps/web/tests/prototypes/g6-projects.test.ts` (19 tests, 200 assertions)
- Scenario matrix: [projects prototype report](../reports/g6-projects-prototype.md) KB-1…KB-4, ST-1, LB-1; Chrome 153 at 390/1440 px
- Design system: root `DESIGN.md`

### History
