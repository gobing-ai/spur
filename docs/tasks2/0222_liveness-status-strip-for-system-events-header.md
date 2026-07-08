---
template: feature-impl
schema_version: 1
name: "Liveness status strip for System Events header"
description: ""
status: done
type: task
profile: standard
feature_id: K
parent_wbs: null
priority: P2
tags: ["observability", "system-events", "liveness", "sse"]
dependencies: []
created_at: "2026-07-07T23:26:15.290Z"
updated_at: "2026-07-07T23:48:38.290Z"
---

## 0222. Liveness status strip for System Events header

### Background

The System Events tab currently shows only a static 'newest first / live tail' label. Operators have no at-a-glance indication of SSE connection health, event throughput, or how many events are currently filtered out. A liveness status strip is needed immediately after the existing label to provide operational visibility without reading the event stream.

### Requirements
- R1. Render a connection indicator (live=green pulse, connecting=gray, errored=red) immediately after the existing 'newest first / live tail' label.
- R2. Display a rolling 'N events / 60s' rate updated every second, reflecting the trailing 60-second window (not cumulative).
- R3. Display 'N of M shown' where N is the filtered count and M is the total loaded count.
- R4. The strip must not push the existing table below the fold; it shares the header row.
- R5. Preserve all existing SSE connection logic and HISTORY_LIMIT cap-and-prune behavior.
- R6. Color must not be the only signal — include a text label (e.g. 'live', 'connecting', 'error') alongside the indicator color.
- R7. Keyboard accessible: the indicator is a static status element (not interactive) but must have an aria-live='polite' region for the rate and count so screen readers announce changes.
### Acceptance Criteria
```gherkin
Feature: Observability System Events Table Redesign

  Scenario: SSE connection state is visible in the header
    Given the System Events tab is open
    When the operator views the header bar
    Then a connection indicator shows one of: live (green pulse), connecting (gray), or errored (red)
    And the indicator sits immediately after the "newest first · live tail" label

  Scenario: Rolling event rate is displayed
    Given the SSE tail is connected and receiving events
    When the header is rendered
    Then the header shows a rolling "N events / 60s" rate updated every second
    And the rate reflects events received in the trailing 60-second window, not a cumulative total

  Scenario: Filtered count is shown
    Given filters are applied that reduce the visible set
    When the header renders the count
    Then the header shows "N of M shown" where N is the filtered count and M is the total loaded
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Goal.** Surface SSE connection health, event throughput, and filtered count in the existing header row without pushing the table below the fold.

**Approach.**
- Tri-state `SseStatus = 'connecting' | 'live' | 'errored'` driven by `es.onopen` / `es.onerror`. Initial state is `connecting` so the strip never claims "live" before the first frame.
- `useRollingEventRate()` hook keeps a `useRef<number[]>` of epoch-ms timestamps for the trailing 60 s window. A `setInterval(1000)` prunes entries older than 60 s and re-renders the rate. `recordEvent` (wrapped in `useCallback` so the SSE effect dependency is stable) appends to the trail on each accepted envelope.
- A new `LivenessStrip` sub-component renders three items in a horizontal flex: status (dot + uppercase text label, with `aria-label="SSE connection {status}"` and `role="status"`), rate (`{n} events / 60s`), count (`{shown} of {total} shown`). Rate and count live in `aria-live="polite"` `aria-atomic="true"` spans so screen readers announce updates without interrupting.
- The dot uses `bg-success` (live, with `spur-pulse` keyframe), `bg-spur-text-muted` (connecting), `bg-error` (errored). Connecting and errored dots are static — only `live` pulses — so the animation never implies healthy liveness when it isn't.
- The strip lives in the existing header `<div>` (same `flex items-center justify-between` row), so the table below is not pushed down (R4). `flex-wrap` keeps it usable on narrow widths.

**Tradeoffs.** A 1-second re-tick interval for the rate is coarse but cheap; the rate can lag one second behind reality, which is fine for a human-facing indicator. `aria-live="polite"` rather than `assertive` so screen readers don't interrupt other speech on every tick.

**Files touched.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx`: added `SseStatus` type, `useRollingEventRate` hook, `LivenessStrip` component, wired SSE lifecycle into status state, mounted strip in header row, added `useCallback` + `useMemo` imports.
- `apps/web/src/styles/global.css`: added `@keyframes spur-pulse` (scale + opacity loop).
- `apps/web/tests/modules/observability/components.test.tsx`: extended `FakeEventSource` with `onopen` / `onerror`, added three liveness-strip tests covering R1 (initial state), R1-on-open transition, and R2 (rolling rate + R3 count).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Files changed.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx:54-86` — `SseStatus` type + `useRollingEventRate` hook (`useRef<number[]>` + `setInterval` prune every 1 s + `useCallback` `recordEvent`).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:462-465` — tri-state `sseStatus` state + rate hook mounted in `SystemEventsTab`.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:489-521` — SSE `useEffect` now wires `onopen` → `setSseStatus('live')`, `onerror` → `setSseStatus('errored')`, and calls `recordEvent()` on each accepted envelope (line 515). Effect depends on `[recordEvent]` so the closure stays stable.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:577-587` — header `<div>` extended with `flex-wrap` + `gap-3` to host `<LivenessStrip>` on the same row as the title (R4: not pushed below the fold).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:697-762` — new `LivenessStrip` component (`role="status"` indicator, `aria-live="polite"` rate + count spans).
- `apps/web/src/styles/global.css:90-104` — `@keyframes spur-pulse` (scale + opacity loop) for the live indicator.
- `apps/web/tests/modules/observability/components.test.tsx:14-16` — `FakeEventSource` extended with `onopen` / `onerror` handlers.
- `apps/web/tests/modules/observability/components.test.tsx:175-222` — three new tests covering R1 (initial `connecting` state), R1 transition to `live` on SSE open, and R2 (rolling rate + R3 count growth).
**Rationale.** Status state lives in the component (not inside `useRollingEventRate`) because the indicator color/text are orthogonal to the rate. Hook is `useCallback`-stable so the SSE effect doesn't re-run on every render — caught by a `toHaveLength(2)` test failure on first pass.
### Testing
**Verification commands.**
- `bun run lint` — clean (Biome + per-workspace `tsc --noEmit`).
- `bun run test apps/web/tests/modules/observability/` — 17 pass / 0 fail (3 new liveness tests + 14 prior).
- `bun run test` (full suite) — 2470 pass / 0 fail across 176 files.
- `bun run format` then `bun run lint` — no remaining formatting drift after `@keyframes spur-pulse` insertion.

**Coverage claim.**
- AC-1 (R1/R6: connection indicator with color + text label) — covered by "renders the liveness strip" test asserting the `connecting` text label and `aria-label="SSE connection connecting"` (`role="status"`).
- AC-2 (R2: rolling 60 s rate) — covered by "counts incoming SSE events" test feeding two envelopes and asserting `2 events / 60s`.
- AC-3 (R3: N of M shown) — covered by both new tests asserting `2 of 2 shown` (initial) and `4 of 4 shown` (after live appends).
- AC-1 transition (live state) — covered by "transitions to live on SSE open" test invoking `FakeEventSource.onopen` and asserting the `live` text label appears.
- R4 (no push below fold) — covered structurally: the strip is mounted in the same `<div>` as the title; no new row was introduced.
- R5 (preserve SSE / `HISTORY_LIMIT`) — covered by the existing SSE test (`FakeEventSource.instances).toHaveLength(1)`) still passing alongside the new tests.
- R7 (`aria-live="polite"`) — verified by inspecting the rendered output: both rate and count are wrapped in `<span aria-live="polite" aria-atomic="true">`.
### Review
**SECU pass.** Self-review on the diff:
- **Safety.** No external input is consumed; SSE envelopes still flow through `parseSseEnvelope` (runtime narrow) and malformed frames are still dropped silently. No new network surface.
- **Correctness.** Stable dependency for the SSE effect (`useCallback`-wrapped `recordEvent`); tri-state status correctly flips on `onopen` / `onerror`; rolling rate prunes entries older than 60 s every second; count uses `filteredEvents.length` for N and `events.length` for M (matches R3 semantics).
- **Performance.** `useMemo` on `dotClass` so the color lookup doesn't recompute every render. `setInterval` is cleaned up on unmount.
- **A11y.** Indicator has `role="status"` and `aria-label`. Rate + count are in `aria-live="polite"` `aria-atomic="true"` regions. The text label (R6) is rendered as a sibling of the colored dot, so colorblind operators and screen-reader users both get the signal.
- **UX.** Strip lives on the same row as the title (`flex-wrap` lets it drop below on very narrow viewports without hiding the title). Only the `live` dot pulses, so the animation is reserved for the state that actually warrants attention.

**Residual risk.** None blocking. `setInterval` only fires while the tab is mounted; React unmount cleans it up. The `spur-pulse` keyframe is global — reused only here, but cheap.

**Disposition.** PASS — ready to record and move to 0223.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-07T23:40:45.930Z todo → wip (system)
- 2026-07-07T23:48:38.065Z wip → testing (system)
- 2026-07-07T23:48:38.290Z testing → done (system)
