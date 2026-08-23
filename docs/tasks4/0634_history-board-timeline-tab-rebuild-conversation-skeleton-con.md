---
schema_version: 1
name: "History Board Timeline Tab: Rebuild conversation skeleton, continuous timeline rail, and chat execution flow to match prototype"
status: done
template: feature-impl
created_at: 2026-08-23T04:52:47.905Z
updated_at: "2026-08-23T21:47:38.816Z"
feature_id: E8
---

## 0634. History Board Timeline Tab: Rebuild conversation skeleton, continuous timeline rail, and chat execution flow to match prototype

### Background
E8 already ships a typed Timeline read path, but the live React composition does not preserve the
prototype's information hierarchy. `apps/web/src/modules/history/TimelineTab.tsx:163` renders session
controls inside a generic selector row, `apps/web/src/modules/history/TimelineTab.tsx:257` wraps each
turn in an isolated card, and `apps/web/src/modules/history/TimelineTab.tsx:343` places telemetry inside
each card. The reference instead uses one compact `Conversation skeleton` panel and a continuous rail
at 136 px (`docs/design/prototypes/history-module/history.css:1196`) with prompt rows, block headers,
and operation rows sharing that rail.

Ready-depth premise verification corrected four draft assumptions:

- The prototype metadata strip has **nine** fields, not eight (`docs/design/prototypes/history-module/history-app.js:695`).
- The transport event-kind vocabulary is `read | write | bash | search | run | user`; it does not expose
  separate `grep`, `glob`, or `edit` kinds (`packages/contracts/src/history.ts:148`). Presentation may
  derive a finer badge/accent from the existing event title, but this task must not widen the contract.
- `HistoryTimelineEvent.tokens` and `HistoryTimelineBlock.totalTokens` are billed-token values that omit
  cache reads (`packages/app/src/services/history-board-service.ts:632` and
  `packages/app/src/services/history-board-service.ts:667`). Prototype-style token load must therefore be
  derived as `freshInputTokens + cacheReadTokens + outputTokens`.
- The Timeline roster currently projects only id/source/model/start
  (`apps/web/src/modules/history/HistoryShell.tsx:160`), while the already-returned Sessions DTO contains
  the three token inputs needed for the selector label (`packages/contracts/src/history.ts:220`). No API
  or database change is required.

The outcome is structural and behavioral parity with the checked-in Timeline prototype—not a literal
port of its imperative JavaScript or stylesheet—while preserving the Board's React, Tailwind/DaisyUI,
responsive, theme, and pure-token contracts.

**In scope**

- Recompose `TimelineTab.tsx` into the compact header, nine-field metadata strip, continuous execution
  rail, prompt rows, assistant block headers, operation cards, disclosure state, and telemetry popovers.
- Add derived token load to the existing 100-row Timeline roster in `HistoryShell.tsx`.
- Extend the existing History component tests and synchronize the History Board surface documentation.

**Out of scope**

- Changes to oRPC contracts, server/application/domain services, SQLite schema, import semantics, or
  prototype assets.
- Changes to Summary, Sessions, Insights, or Sources behavior; new chart helpers; new packages; a new
  stylesheet; or a new timeline component directory.
- Currency/cost fields, fabricated error counts, or inferred command/file targets that the DTO does not
  provide.
### Requirements
- **R1 — Conversation header and roster navigation:** Render one panel headed exactly `Conversation skeleton`.
  Its toolbar contains a native session selector, Previous/Next icon buttons, and one global
  `Expand all` / `Collapse all` button. Each roster option is
  `<first8…last4> · <source> · <UTC month/day time> · <formatted token load>`. Extend the module-local
  roster projection with `tokenLoad = freshInputTokens + cacheReadTokens + outputTokens`; do not change
  a transport DTO. Previous/Next follow the existing start-desc roster order without wrapping and are
  disabled at bounds or when the active session is absent.

- **R2 — Nine-field session metadata:** Below the toolbar render, in this order: `SESSION`, `AGENT`,
  `MODEL`, `STARTED`, `DURATION`, `TOTAL TOKENS`, `CACHE READ`, `OUTPUT TOKENS`, `TOOL CALLS`.
  SESSION displays `first8…last4` with the full id in an accessible title; Agent uses the existing
  `AgentIcon`; Model has a restrained accent dot. `TOTAL TOKENS` is the full token load
  (`fresh + cache read + output`). `CACHE READ` is
  `cacheReadTokens / (freshInputTokens + cacheReadTokens) * 100`, formatted to one decimal, with a
  zero-denominator result of `0.0%`.

- **R3 — One chronological rail:** Replace per-turn outer cards with one relative stream containing a
  single continuous vertical rail. At desktop width the rail is fixed at 136 px and every user row,
  assistant block header, and non-user event has a node centered on it. Reuse the server-supplied block
  order and `(turnIndex, seq)` event identity; do not regroup or sort transport data in the browser.
  Tool telemetry shows duration and full token load with the existing `SparkBar`; `>= 5000 ms` is hot
  amber and `>= 50000` tokens is heavy cyan.

- **R4 — Prompt rows:** Render `kind === 'user'` as a rail-connected prompt disclosure with a `PROMPT`
  badge, summary, fresh-input chip, character count, and chevron. The full prompt is trimmed payload
  when present, otherwise title; the summary is its first non-empty line with visual truncation, and the
  character count uses the full chosen prompt string. Only a non-empty payload creates an expandable
  drawer.

- **R5 — Assistant operation blocks:** For each transport block, render one compact block header for
  its non-user events: UTC clock, rail node, Agent icon/source, model dot/name, operation count, summed
  duration, and summed full token load. Agent/model identity appears at block level only, not repeated
  on every operation card. A block containing only user events has no empty assistant header.

- **R6 — Operation cards and honest payloads:** Render each non-user event as an accent-bordered
  disclosure button plus metadata row. A module-local presentation map recognizes `glob`, `grep`, and
  `edit` from `event.title` before falling back to the closed event kind; use indigo, purple, and yellow
  respectively, with kind fallbacks read/emerald, write/rose, bash/blue, search/purple, run/amber.
  Display the recognized uppercase badge, the transport title, `[EXIT_CODE=N]` when non-null, and fresh
  input/cache read/output chips. Do not display a fabricated error count. The drawer renders the
  transport payload verbatim in a dark, horizontally scrollable monospace surface.

- **R7 — State, accessibility, responsiveness, and themes:** Keep disclosure state isolated by session
  using `(turnIndex, seq)` keys. Global expand/collapse targets only events with non-empty payloads and
  exposes `aria-pressed`; each disclosure uses a native button with `aria-expanded` and `aria-controls`.
  Telemetry opens on hover and focus, closes on blur or Escape, and remains screen-reader-associated.
  At widths below 640 px, move the rail to 8 px, use a single content column, place telemetry above its
  card, and preserve >=44 px touch targets without horizontal page overflow. Use DaisyUI semantic
  surfaces/text/borders for both Board themes; hard-coded colors are limited to category telemetry and
  the terminal surface. Preserve the existing no-currency guard.

- **R8 — Executable evidence and surface synchronization:** Extend
  `apps/web/tests/modules/history/components.test.tsx` for header/metadata formulas, roster traversal,
  rail/node structure, prompt and operation disclosures, session-isolated/global expansion, tooltip
  keyboard behavior, and honest fallbacks. Update `docs/design/history-board-module.md` (including task
  0634 in its task/workstream metadata) and its `docs/04_DESIGN.md` index summary in the same change.
  Targeted History tests and the repository quality gates must pass without skips or new dependencies.
### Acceptance Criteria
```gherkin
Feature: History Board Timeline prototype-parity rebuild

  @core
  Scenario: Timeline tab inspects session execution with Agent and Model tags
    Given a selected session containing a user prompt and multiple tool operations with token telemetry
    And the session occupies a known position in the filtered start-desc roster
    When the operator opens the Timeline tab
    Then one panel titled "Conversation skeleton" contains the session selector, bounded Previous and Next controls, and the global disclosure control
    And the metadata strip renders SESSION, AGENT, MODEL, STARTED, DURATION, TOTAL TOKENS, CACHE READ, OUTPUT TOKENS, and TOOL CALLS in that order
    And total token values equal fresh input plus cache read plus output while the cache-read percentage uses cache read divided by fresh input plus cache read
    And one continuous rail anchors the prompt row, the assistant block header, and every operation row
    And the assistant header shows Agent and Model identity once with operation count, summed duration, and summed full token load
    And every operation card shows an honest category badge, title, available exit code, token breakdown, and payload disclosure without fabricated fields
    And Previous and Next disable at their corresponding roster boundaries and navigation never wraps
    And Expand all expands only non-empty prompt and operation payloads for the active session
    And switching sessions does not leak disclosure state into the new session
    And disclosure buttons expose aria-expanded and aria-controls
    And telemetry is available by hover and keyboard focus and closes on Escape
    And the rail and telemetry reflow below 640 pixels without an inner timeline scrollbar or horizontal page overflow
    And semantic surfaces and text retain readable contrast while tool accents and terminal payloads remain distinguishable
    And no oRPC, service, database, currency, or new dependency surface is introduced
```
### Q&A
**Q: Is this a backend or schema task?**

A: No. `HistoryTimelineResponse` already supplies session metadata, ordered blocks, event identity,
token components, exit code, and payload. The existing Sessions response already supplies the roster
token components. This task changes only the module-local roster projection and Timeline presentation.

**Q: What does `TOTAL TOKENS` / step token load mean here?**

A: It is processing load: `freshInputTokens + cacheReadTokens + outputTokens`. The transport's
`tokens`/`totalTokens` fields are billed-token values and intentionally omit cache read, so the Timeline
must not reuse them for prototype telemetry. `CACHE READ` is a ratio over input only:
`cache / (fresh + cache)` with zero mapped to `0.0%`.

**Q: How can GREP, GLOB, and EDIT have distinct accents when the enum is coarser?**

A: Presentation recognizes those canonical tool names from `event.title` first, then falls back to
`event.kind`. This is display-only and does not widen or reinterpret the transport contract.

**Q: Does “match prototype” mean importing `history.css` or reproducing fixed pixels?**

A: No. The prototype freezes information hierarchy, density, rail geometry, disclosure behavior, and
telemetry semantics. React state, Tailwind/DaisyUI tokens, root `DESIGN.md`, current Board themes, and
responsive behavior remain authoritative for implementation mechanics.

**Q: What happens when roster or payload data is missing?**

A: A session absent from the roster disables both steppers; selector labels use the values already
present in each roster row. Empty payloads have no disclosure control. Prompt text falls back to title,
unknown model/source strings render honestly, and no target path, stdout type, or error count is guessed.

**Q: What existing work does this task build on?**

A: Completed task 0626 owns the five-tab React module and task 0634 replaces only its Timeline
presentation. It must preserve the E8 oRPC seam and all non-Timeline tab behavior. Surface documentation
is synchronized in this task; there is no dependent WBS handoff.
### Design
**WHAT / WHY / WHERE**

Recompose the existing Timeline into the checked-in prototype's compact conversation skeleton so an
operator can scan chronology, latency, token load, and payloads without disconnected turn cards. The
implementation stays in the existing React History module and uses current DTOs; no transport or data
ownership moves.

**Frozen change surface**

| Path | Change |
| --- | --- |
| `apps/web/src/modules/history/TimelineTab.tsx` | Rebuild the Timeline composition; keep helpers and small subcomponents local. |
| `apps/web/src/modules/history/HistoryShell.tsx` | Add `tokenLoad` to `TimelineRosterEntry` and derive it from the existing Sessions item fields. |
| `apps/web/tests/modules/history/components.test.tsx` | Replace/extend Timeline fixture and behavioral assertions. |
| `docs/design/history-board-module.md` | Update Timeline surface/mechanism and add 0634 to task/workstream metadata. |
| `docs/04_DESIGN.md` | Synchronize the History Board satellite index description/version. |

`AgentIcon`, `fmtTok`, `fmtMs`, and `SparkBar` are reuse targets, not new abstractions. Do not modify
`packages/contracts`, `packages/app`, `packages/domain`, `apps/server`, other History tabs, or prototype
assets. Do not create a new component directory or stylesheet.

**Frozen local names and formulas**

- Extend `TimelineTabProps.availableSessions` and `HistoryShell`'s `TimelineRosterEntry` with
  `tokenLoad: number`.
- Add local pure helpers `tokenLoad(fresh, cache, output)`, `cacheReadPercent(fresh, cache)`,
  `shortSessionId(id)`, `sessionOptionLabel(row)`, `promptText(event)`, and
  `toolPresentation(event)` in `TimelineTab.tsx`. They are module-private; no exported API is added.
- `tokenLoad = freshInputTokens + cacheReadTokens + outputTokens` at event, block, session, and roster
  levels. Do not display `event.tokens` or `block.totalTokens` as full load.
- `cacheReadPercent = denominator > 0 ? cacheReadTokens / (freshInputTokens + cacheReadTokens) * 100 : 0`.
- `shortSessionId` returns the original id when short enough; otherwise `first8…last4` and always keeps
  the full id in the semantic title.
- `toolPresentation` checks normalized title for `glob`, `grep`, and `edit` before enum fallback and
  returns only `{ label, color }`. It must not parse payload content or change event meaning.

**Composition and state algorithm**

1. Preserve the existing loading/error/empty branches and `expandedBySession` state.
2. Build `expandableKeys` from events whose trimmed payload is non-empty. `allExpanded` and the global
   toggle operate on that set only; `(turnIndex, seq)` remains the collision-safe key.
3. Render one semantic panel. Its header owns title, select, bounded steppers, and the global toggle;
   its second row owns the ordered nine-field metadata strip.
4. Render one `relative` stream with a single rail. Consume `blocks` in supplied order. For each block,
   render user events as prompt rows; when non-user events exist, render exactly one assistant header
   followed by those operation rows. Counts and aggregates use the rendered non-user events.
5. Each operation row owns a telemetry button, node, and disclosure card. The tooltip stays associated
   by `aria-describedby`; the disclosure button owns `aria-expanded`/`aria-controls`. Payload text is
   rendered verbatim, never as HTML.

**Layout and theme contract**

- Desktop: `136px minmax(0, 1fr)` row grid; rail at 136 px; node centered on the rail; telemetry right-
  aligned in the fixed column; content offset by 20 px. No per-turn outer border/background.
- Below 640 px: rail at 8 px; one content column with 24 px left offset; telemetry becomes an inline row
  above the event card; header controls and nine metadata fields wrap; interactive controls retain
  at least 44 px touch height. The Timeline uses document flow with no fixed height/inner scrollbar.
- Use DaisyUI `base-*`, `base-content`, `primary`, and semantic border tokens. Tool-category and telemetry
  colors are the only multi-color accents; the payload drawer may remain fixed dark (`#0d141f`) with
  explicit high-contrast text. Respect reduced motion and native focus-visible rings.

**Anti-patterns**

- No contract/schema/service change to obtain display-only values.
- No import or translation of the prototype's imperative JavaScript/CSS.
- No client-side re-sort/regroup of server blocks, no use of array position as event identity, and no
  duplicate agent/model chips on operation cards.
- No fabricated `0 errors`, inferred file target, output type, cost, or currency field.
- No custom keyboard emulation on native buttons, new dependency, global CSS, or unrelated History-tab cleanup.

**Handoff / authority**

Task 0626 is the completed upstream implementation; 0634 supersedes only its Timeline presentation.
Feature E8's exact Timeline scenario title remains the traceability anchor. `DESIGN.md` governs shared
visual/accessibility rules, while `docs/design/history-board-module.md` owns this surface and must be
updated in the same implementation change (T3). No downstream task inherits unfinished scope.
### Plan
- [x] Extend the existing Timeline roster projection and prop shape with derived `tokenLoad`; preserve
  the start-desc 100-row query, selected-session flow, and all unrelated `HistoryShell` behavior (R1).
- [x] Add the frozen local formatting/token/presentation helpers and narrow disclosure state to non-empty
  payload keys; keep `(turnIndex, seq)` identity and per-session isolation (R1, R2, R6, R7).
- [x] Rebuild the single panel header and ordered nine-field metadata strip, including deterministic
  session labels, honest token formulas, bounded steppers, and accessible global toggle (R1, R2).
- [x] Replace per-turn cards with the one-rail stream, responsive desktop/mobile geometry, prompt rows,
  and non-empty assistant block headers using supplied block order (R3, R4, R5).
- [x] Rebuild operation telemetry, accessible popovers, category presentation, exit/token metadata, and
  verbatim dark payload disclosures using existing `AgentIcon` and `SparkBar` (R3, R5, R6, R7).
- [x] Extend `components.test.tsx` with fixtures containing cache reads, duplicate seq values, empty and
  non-empty payloads, multiple roster positions, and unknown title/kind fallbacks. Assert formulas,
  header/metadata order, rail/node counts, bounded navigation, per-session/global disclosures,
  `aria-*`, focus/Escape telemetry, and absence of fabricated/currency fields (R1–R8).
- [x] Synchronize the Timeline section/task map in `docs/design/history-board-module.md` and its entry in
  `docs/04_DESIGN.md`, then compare the live Timeline against `proto-timeline.png` and
  `proto-timeline-expanded.png` at desktop and below 640 px in both Board themes. Verify no inner
  timeline scrollbar/horizontal page overflow and retain >=44 px touch targets; do not edit prototype
  assets or unrelated numbered docs (R3–R8).
- [x] Run the focused Timeline component test first, then `bun run autofix`, `bun run spur-check`,
  `bun run test-cf`, `bun run build`, and `bun run corpus-check`; record exact evidence during verify (R8).
### Solution
Curated change-map — one row per changed file, anchored at the primary symbol each change implements.

| Change | Anchor |
|--------|--------|
| `TimelineTab` — rebuilt Conversation skeleton header, nine-field metadata, 136px continuous rail, assistant block headers, prompt rows, tool presentation map, and telemetry popovers | `apps/web/src/modules/history/TimelineTab.tsx:306` |
| `HistoryShell` — added `tokenLoad` to `TimelineRosterEntry` derived from fresh input + cache read + output tokens | `apps/web/src/modules/history/HistoryShell.tsx:21` |
| Timeline component tests covering formulas, 9-field metadata, tool category mapping, bounded roster traversal, disclosures, and telemetry | `apps/web/tests/modules/history/components.test.tsx:390` |
| Synchronized Timeline specification and task mapping in History Board design satellite | `docs/design/history-board-module.md:10` |
| Synchronized History Board satellite reference in 04_DESIGN.md | `docs/04_DESIGN.md:66` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns the Conversation skeleton controls and receives the start-desc roster with full token load; the focused test named 'Timeline prev/next are disabled at roster bounds and options include formatted token load' verifies labels, bounds, traversal, and absent-session behavior. |
| R2 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns the ordered nine-field metadata strip and formulas; the focused test named 'Timeline renders Conversation panel with filter checkboxes, ordered 9-field metadata, and formula calculations' verifies field order, full load, cache ratio, zero denominator, and pure-token output. |
| R3 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns the single responsive rail and full-load duration/token meters with hot/heavy thresholds; the focused test named 'Timeline renders compact cards with Sources AgentIcon tooltip, as-is tool badge, UserTokenBadge prompt, and filters' verifies rail geometry and node counts. |
| R4 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns prompt rows built from trimmed payload/title fallback with disclosure state; the focused telemetry test verifies the badge, summary, character count, accessible drawer, and trimmed full prompt. |
| R5 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns one assistant header per block with desktop/mobile UTC time, agent, model, operation count, summed duration, and summed full load; the focused telemetry test verifies both headers. |
| R6 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns title-first glob/grep/edit recognition, closed-kind fallbacks, accent cards, exit/token metadata, and verbatim payloads; the focused honest-badges test verifies mapping, empty payload, exit codes, and honest fields. |
| R7 | MET | `apps/web/src/modules/history/TimelineTab.tsx:306` owns per-session disclosure state, keyboard telemetry, 44px mobile targets, reduced motion, 8px/136px rail reflow, and semantic surfaces; the focused telemetry test verifies hover/focus/blur/Escape and session isolation. Headless Chrome confirmed both themes, zero page overflow, no inner scrollers or undersized Timeline controls, 136px/8px rail positions, and the visible mobile UTC clock. |
| R8 | MET | `docs/design/history-board-module.md:10` carries the synchronized Timeline contract and the numbered design index references it. Fresh gates: focused Timeline 4 pass/73 assertions; History components 14 pass/147 assertions; autofix/typecheck clean; spur-check 6232 pass with 99.07% lines/99.20% functions; test-cf 1 pass; build exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Timeline tab inspects session execution with Agent and Model tags | MET | test | `bun test apps/web/tests/modules/history/components.test.tsx --test-name-pattern Timeline` exited 0: 4 pass, 73 assertions. `bun run spur-check` exited 0: 6232 pass; `bun run test-cf` and `bun run build` exited 0. Headless Chrome at 1440x1000 and 390x844 verified the collapsed/expanded Timeline in light/dark themes with zero page overflow. Static review at `apps/web/src/modules/history/TimelineTab.tsx:306` confirms no contract/service/database/dependency surface was added. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Parent feature: [E8 History Board module](../features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- Completed upstream task: [0626 History Board web module](./0626_history-board-web-module-5-tab-ui-implementation-with-astro-.md)
- Surface design: [History Board module](../design/history-board-module.md)
- Root visual/accessibility SSOT: [DESIGN.md](../../DESIGN.md)
- Prototype markup/behavior/style:
  [HTML](../design/prototypes/history-module/spur-board-history.html),
  [controller](../design/prototypes/history-module/history-app.js), and
  [CSS](../design/prototypes/history-module/history.css)
- Visual baselines:
  [collapsed](../design/prototypes/review-artifacts/proto-timeline.png),
  [expanded](../design/prototypes/review-artifacts/proto-timeline-expanded.png), and
  [current live drift](../design/prototypes/review-artifacts/live-timeline.png)
- Current implementation seams: `apps/web/src/modules/history/TimelineTab.tsx`,
  `apps/web/src/modules/history/HistoryShell.tsx`, `packages/contracts/src/history.ts`, and
  `packages/app/src/services/history-board-service.ts`
### History
- 2026-08-23T05:19:13.143Z todo → wip (system)
- 2026-08-23T05:19:53.771Z wip → testing (system)
- 2026-08-23T05:19:58.635Z testing → done (system)
