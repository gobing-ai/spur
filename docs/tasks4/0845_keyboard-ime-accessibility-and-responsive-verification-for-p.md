---
schema_version: 1
name: Keyboard, IME, accessibility, and responsive verification for Projects
status: done
template: feature-impl
created_at: 2026-09-12T04:54:51.546Z
updated_at: "2026-09-13T03:30:51.531Z"
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

Solution: the prototype's interaction contract (KB-1…KB-4, ST-1, LB-1) is carried to the production
module as one submit decision for the composer keyboard plus structural a11y/responsive invariants —
each scenario re-authored as a production test, not re-derived by hand (R5). Change map:

- `apps/web/src/components/GlobalAgentBar.tsx:22-36` — `onComposerKeyDown` is the single submit
  decision: plain Enter submits once; an Enter with `isComposing` OR legacy `keyCode === 229`
  submits nothing (R1, KB-3a/KB-3b); Shift+Enter is not prevented so the textarea inserts the
  newline natively (KB-2). Empty body submits nothing.
- `apps/web/src/components/GlobalAgentBar.tsx:149-172` — the `data-agent-bar-live` status region
  exists in BOTH dock and collapsed branches, so a receipt transition is announced even while the
  bar is folded (R3).
- `apps/web/src/modules/projects/ProjectsShell.tsx:69-77` — tablist keydown: ArrowLeft/ArrowRight
  wrap across `PROJECT_TABS`, move focus with the selected tab, and drive `selectTab` (R2); Tab and
  Enter keep working through the native tab buttons.
- `apps/web/src/modules/projects/AgentsView.tsx:33` — roster issue rows render icon + text, never
  colour-alone (R3); the receipt vocabulary is frozen to the prototype STATUS table in
  `apps/web/src/modules/projects/receipt.ts`.
- Task chip (0841 P3 carried): `data-g6="task-chip"` is a native labeled button removable by
  activation; the 0844 bar controls (dock, drawer toggle, collapse, composer, Send) are labeled
  native controls with the unbound-orchestrator state named in a status region (`a11y.test.tsx:285-323`).
- Production tests: `apps/web/tests/modules/projects/keyboard.test.tsx` (5 tests: KB-1…KB-3b),
  `a11y.test.tsx` (8 tests: tablist roles/aria-selected + arrow navigation, KB-4 Escape/focus
  restore, ST-1 receipt icon+label, live region, task chip, bar parity), `responsive.test.tsx`
  (3 tests: LB-1 min-width ≤ 390 px, overflow-x owners, breakpoint-qualified wrapping rows).
- `bunx tsc --noEmit -p apps/web` rc 0 — 5 pre-existing errors fixed without `as any`:
  `ProjectsShell.tsx` tab-cycle narrowed with an `if (!next) return` guard; `keyboard.test.tsx`
  `releasePost` declared without an initializer so the fetch-callback assignment is not flow-narrowed
  to `null`; `responsive.test.tsx` regex capture groups read with `?? ''` (NaN then fails the
  assertion loudly).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/components/GlobalAgentBar.tsx:28-34` — `shouldSubmit` checks BOTH composition signals (`!isComposing` AND `keyCode !== 229`) plus `key === 'Enter'` and `!shiftKey`; `:191-193` `onKeyDown` `preventDefault()`s then calls the single 0844 `handleSubmit` only on a true verdict, non-submitting keys left native (Shift+Enter newline is the textarea's). Tests: KB-3a `keyboard.test.tsx:129`, KB-3b `:144`, KB-2 `:158`, KB-1 `:172` (exactly one POST, `pending` first), empty-Enter `:216`. Browser: KB-3 (degraded composition-Enter, 0 posts) + KB-1 (post-composition Enter, exactly 1 post with composed payload) at BOTH widths — `.spur/run/g63-projects/browser-results.json` 18/18 `ok:true`. |
| R2 | MET | `apps/web/src/modules/projects/ProjectsShell.tsx:71-82` — tablist keydown: ArrowRight/ArrowLeft wrap across `PROJECT_TABS`, move focus with selection, drive `selectTab`. Tests: tablist roles + `aria-selected` + `aria-controls`↔`id` pairing `a11y.test.tsx:135`, arrow nav with focus follow `:158`, KB-4 Escape closes member detail and `document.activeElement` is the opening card `:179`. Browser: "R2 arrow keys move active tab" (ArrowRight→agents selected+focused, ArrowLeft→conversation) and "KB-4 Escape closes detail, focus restored" at BOTH widths. |
| R3 | MET | `apps/web/src/modules/projects/receipt.ts:76` — closed `RECEIPT_LABELS` vocabulary, icon+label+meaning+action per state (distinctness asserted `a11y.test.tsx:201`); roster issues never colour-alone — `AgentsView.tsx:33-47` `ISSUE_FACTS` icon + label + action; live region `role="status" aria-live="polite"` with `data-agent-bar-live` in BOTH branches — `GlobalAgentBar.tsx:150` and `:172`; transition announcement asserted `a11y.test.tsx:216`. Browser: "ST-1 receipt announced + labelled" (strip `⏸queued-awaiting-orchestrator — …`, live region carries label + "Next:" action) at BOTH widths. |
| R4 | MET | Structural half: `responsive.test.tsx:143` (no rendered element declares min-width > 390 px in any view), `:154` (kanban track and terminal pane own their overflow-x containers), `:176` (roster rows wrap on breakpoint-qualified tracks). Geometric half: `.spur/run/g63-projects/browser-results.json` LB-1 — `scrollWidth == innerWidth` on conversation, agents, work at BOTH 390 px and 1440 px, zero page errors, 6 full-page screenshots (`conversation |
| R5 | MET | Every prototype scenario exists as a production test: KB-1 `keyboard.test.tsx:172`, KB-2 `:158`, KB-3a/b `:129/:144`, KB-4 `a11y.test.tsx:179`, ST-1 `:201`, LB-1 `responsive.test.tsx:143-184` + browser runner. Prototype suite KEPT per the CLOSED decision — `apps/web/tests/prototypes/g6-projects.test.ts` included in the fresh 912-pass full run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Keyboard, IME, and accessibility hold | MET | test | `keyboard.test.tsx:129-224` (isComposing Enter, keyCode-229 Enter, Shift+Enter, plain Enter ×1) + `a11y.test.tsx:135-197` (tablist/aria-selected/arrows, Escape focus restore) + browser 18/18: KB-3 composition-Enter submits nothing, KB-1 post-composition Enter submits exactly once, R2 tabs, KB-4 Escape — both widths. |
| Layout holds at both widths | MET | test | Structural `responsive.test.tsx:143-184`; geometric browser LB-1 `scrollWidth == innerWidth` on all three views at 390 px and 1440 px, zero page errors (`.spur/run/g63-projects/browser-results.json`, `ok:true`). |
| State changes are announced | MET | test | `a11y.test.tsx:216` receipt transition writes label + action into `data-agent-bar-live`, region present in dock AND collapsed branches; browser ST-1 at both widths: live region reads `queued-awaiting-orchestrator — Next: bind/restore an orchestrator…` after the pending → queued flip. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0845

**Scope:** task diff — `apps/web/src/components/GlobalAgentBar.tsx` (composer key guard + live region), `apps/web/tests/modules/projects/{keyboard,a11y,responsive}.test.tsx` (new), untracked `.spur/run/g63-projects/{browser-check.mjs,browser-results.json}`, planned report satellite `docs/reports/g6-projects-prototype.md`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL

Fresh evidence this review (re-run, not inherited): `cd apps/web && bun test` (full) → **912 pass / 0 fail**, 3993 expect() calls, 68 files; `bunx tsc --noEmit -p apps/web` → rc 0; `.spur/run/0845-test-gate.status` = 0, bind digest `sha256:ff965746073084d3f9e2b9a8b83b962f8d82ae28e5851838577199875a8746fd` matches `.spur/run/proofDigest`. Frozen contracts intact: tab ids `conversation|agents|work` frozen order (`apps/web/src/modules/projects/tabs.tsx:15-20`), the 0845 diff touches only the composer/bar + tests (wire projection, addRef path `ConversationView.tsx:198-212`, and the receipt vocabulary `receipt.ts:96-166` are untouched), and the only added test attribute is the frozen `data-agent-bar-live`. (The bare pipeline-verify placeholder — SECU verdict UNKNOWN — that previously opened this section is superseded by this authored review; its verify-step UNKNOWN verdict is recorded here.)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | R4's geometric half is UNVERIFIED: the saved browser run is a failure — `.spur/run/g63-projects/browser-results.json` (startedAt 2026-09-13T02:46:30Z, chrome 140.0.7339.16) records `ok:false`, the runner aborted on `Input.imeSetComposition` "Invalid parameters" mid-KB-3 at 390 px, only KB-2@390 passed, ZERO scenarios ran at 1440 px, `screenshots:[]`, and plan step 7's production receipt was never appended to `docs/reports/g6-projects-prototype.md` (no 0845/Chrome-140 content in the file; its only browser evidence is the prototype's). R4 as written ("verified at 390 px and 1440 px") therefore holds only its structural half. | `.spur/run/g63-projects/browser-check.mjs:141-148` | fix hop before approve: repair the CDP composition call (match the prototype runner's parameter shape, `docs/reports/g6-projects-prototype.md:87`) or degrade to `insertText` + contract-shaped composition events; re-run BOTH widths to `ok:true`, then append the receipt to the report |
| 2 | P3 (minor) | correctness | The structural half has known blind spots the crashed geometric half was meant to cover: `assertNoWideMinWidth` matches only `min-w-[Npx|Nrem]` arbitrary values and inline `min-width:Npx` — a fixed `w-[420px]`, an intrinsic-width image, or an unbreakable string without an overflow owner passes the structural test yet overflows 390 px. Not a defect of the Q&A-closed split (geometry belongs to the browser half), but until finding 1 resolves, R4 rests on this narrower invariant. | `apps/web/tests/modules/projects/responsive.test.tsx:105-113` | resolves with finding 1's re-run |
| 3 | P4 (advisory) | correctness | No explicit happy-dom assertion of the over-swallow direction — a plain Enter AFTER a composition commits must still submit. Static reading is sound: post-`compositionend` Enter carries `isComposing:false` and `keyCode ≠ 229` → submits, while WebKit's post-compositionend replay Enter (`keyCode 229`, `isComposing false`) is correctly swallowed as the composition Enter. The crashed runner's commit-then-Enter sequence was designed to prove this end to end; it arrives with finding 1's re-run. | `apps/web/src/components/GlobalAgentBar.tsx:28-35` | accept static analysis now; add browser assertion in finding 1's re-run |
| 4 | P4 (advisory) | architecture | Tablist satisfies the stated bar (aria-selected parity with frozen ids + arrow-cycle focus-follow) but not strict APG roving tabindex: all three tabs remain in the Tab order and Home/End are unhandled. Acceptable at three tabs; revisit if the count grows. | `apps/web/src/modules/projects/ProjectsShell.tsx:69-84,130-147` | accept; note for any future tab addition |
| 5 | P4 (advisory) | functional | Solution section labels the task chip "0841 P3 carried", but 0841's P3-on-record was `parseDraftRecord` stripping the additive `pending` field (dispositioned to 0844 and fixed there — `drafts.tsx:61-64` now spreads `{...r}` through). The chip keyboard parity here is the carried usability intent, not that P3; relabel at wrap so the audit trail stays accurate. | `docs/tasks4/0845…md` § Solution | relabel in-task at wrap |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Guard checks BOTH composition signals — `GlobalAgentBar.tsx:28-35` (`isComposing` + `keyCode !== 229`); `onKeyDown` `preventDefault()`s before the single `handleSubmit` and leaves non-submitting keys native (`:186-194`); tests: KB-3a `keyboard.test.tsx:129-142` (no POST, event not prevented), KB-3b `:144-155`, KB-2 `:157-167` (no POST, newline native), KB-1 `:169-210` (exactly one POST, `preventDefault` true, `pending` persisted before ack, same receipt as Send), empty-Enter `:212-224`. Real-key IME dispatch is the browser runner's job — see finding 1 |
| R2 | MET | Tablist roles + `aria-selected` + `aria-controls`↔`id` pairing with only the active panel mounted (`a11y.test.tsx:135-156`); ArrowRight/ArrowLeft wrap across the frozen three tabs with focus following (`:158-176` ↔ `ProjectsShell.tsx:69-84`); KB-4 Escape closes member detail and `document.activeElement` is the opening card (`a11y.test.tsx:179-197`, 0842 contract) |
| R3 | MET | Closed 12-state receipt vocabulary, each state non-empty distinct icon AND label AND meaning AND action + tone (`receipt.ts:96-166`, asserted `a11y.test.tsx:201-214`); polite `role="status"` region with `data-agent-bar-live` in BOTH dock and open branches (`GlobalAgentBar.tsx:150-151,172-173`); a pending→queued-awaiting-orchestrator transition is announced and survives folding the bar (`a11y.test.tsx:216-262`); roster issue rows render icon + text + action, never colour-alone (`AgentsView.tsx:238-244`) |
| R4 | PARTIAL | Structural half MET: no rendered element in any view declares min-width > 390 px (`responsive.test.tsx:143-152`), kanban track and terminal pane own their overflow-x containers (`:154-174`), roster rows wrap on breakpoint-qualified tracks with no fixed track count (`:176-184`). Geometric half UNVERIFIED — finding 1 (`ok:false` run, no 1440 evidence, no report receipt) |
| R5 | MET | KB-1…KB-4, ST-1, LB-1 all exist as production tests (`keyboard.test.tsx`, `a11y.test.tsx`, `responsive.test.tsx`); the prototype suite is kept intact per the CLOSED decision (`apps/web/tests/prototypes/g6-projects.test.ts`, included in the fresh 912-pass full run) |

**Next:** one fix hop before the approve gate — finding 1 only: repair/re-degrade the browser runner's IME composition step, re-run both viewports to `ok:true` with screenshots, append the production receipt to `docs/reports/g6-projects-prototype.md` (plan step 7), then relabel finding 5 at wrap. No production-code change required.

#### Review Addendum — re-review after browser fix hop (run c6cc48b0)

**Scope:** fix-hop delta only — untracked runner `.spur/run/g63-projects/browser-check.mjs`, results `.spur/run/g63-projects/browser-results.json`, 6 screenshots, receipt appended at `docs/reports/g6-projects-prototype.md:89-110`. No code delta: newest mtime under `apps/web/src` and `apps/web/tests` is 2026-09-13T02:53Z — before the report below was authored (03:06Z) and before the browser re-run (03:14Z); all code anchors cited below re-verified unchanged.
**Dimensions:** correctness (runner/results consistency), functional (receipt completeness), honesty (degradation note)
**Verdict:** PASS

Evidence re-checked fresh this hop, not inherited: `browser-results.json` (startedAt 2026-09-13T03:14:44Z, chrome 140.0.7339.16) records **18/18 scenarios `ok:true` at both 390 px and 1440 px**, `pageErrors: []`, 6 screenshots on disk, `ok: true`; `.spur/run/0845-test-gate.status` = 0 with rebound digest `sha256:da3b0e6f786732e762d510db5890ff60f3dd9285d6b7bbef4310f5683c1b8a14` matching `.spur/run/proofDigest` (prior `ff965746…` superseded — report + browser artifacts are in-fingerprint). Runner-internal consistency: per-width post deltas are correct (`postsBefore` captured per viewport — 390: 0→0→1, 1440: 1→1→2, `postCount: 2`); the KB-3 detail records the two dispatched composition-Enters (`isComposing:true`, `keyCode:229`) the guard must swallow, and KB-1 proves the post-composition plain Enter still submits exactly once with the composed payload. The receipt at `docs/reports/g6-projects-prototype.md:89-110` is complete (Chrome version, both widths, pass count, reproduction command, screenshot table) and its degradation note (`:100-103`) is honest: every `Input.imeSetComposition` shape rejected on Chrome 140, fallback named (`Input.insertText` + contract-shaped KeyboardEvents, the same shape the happy-dom suite dispatches), real-composition guard located in production code, and the untested surfaces (OS candidate windows, mobile keyboards, other browsers, AT speech) restated rather than claimed.

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | Receipt prose enumerates the rejected `imeSetComposition` shapes as "negative and absolute selections, with and without `compositionLength`/`compositionStart`" (four described combos) while the fix-hop note says "5 variants probed"; both agree on the substance ("every parameter shape" → "Invalid parameters") and the `degraded` field in `browser-results.json` records it. Enumeration count only; nothing verdict-relevant. | `docs/reports/g6-projects-prototype.md:100-103` |

**Prior-finding dispositions (report below):**
- Finding 1 (P2, R4 geometric half UNVERIFIED) — **RESOLVED**: both widths re-run `ok:true`, `scrollWidth == innerWidth` on all three views at 390 and 1440, zero page errors, screenshots captured, production receipt appended (plan step 7 complete).
- Finding 2 (P3, structural blind spots) — **RESOLVED**: receipt explicitly closes the gap (`docs/reports/g6-projects-prototype.md:105-107`) — the geometric run sees what the min-width regex cannot.
- Finding 3 (P4, post-composition plain Enter) — **RESOLVED**: KB-1 "Enter after composition submits exactly once" now asserted end to end in real Chrome at both widths, payload carries the composed text.
- Finding 4 (P4, tablist not strict APG roving tabindex) — unchanged, disposition stands (accept at three tabs).
- Finding 5 (P4, Solution labels the task chip "0841 P3 carried") — **still open**, advisory only: relabel at wrap so the audit trail stays accurate.

**Next:** proceed to the approve gate; finding 5 relabel at wrap.

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Evidence to carry forward: `apps/web/tests/prototypes/g6-projects.test.ts` (19 tests, 200 assertions)
- Scenario matrix: [projects prototype report](../reports/g6-projects-prototype.md) KB-1…KB-4, ST-1, LB-1; Chrome 153 at 390/1440 px
- Design system: root `DESIGN.md`

### History

- 2026-09-13T02:56:59.662Z todo → wip (system)
- 2026-09-13T02:57:00.146Z wip → testing (system)
- 2026-09-13T03:30:51.531Z testing → done (system)

