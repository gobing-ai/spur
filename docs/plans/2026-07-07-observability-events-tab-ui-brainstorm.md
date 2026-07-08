---
title: "Observability System Events tab — dense sortable table + liveness strip + redesigned filter bar"
date: 2026-07-07
topic: observability-events-tab-ui
needs_design: true
---

# Brainstorm — Observability System Events tab UI enhancement

## Overview

The current `SystemEventsTab.tsx` (apps/web/src/modules/observability, 612 lines) renders the event
ledger as a vertical list of daisyUI `Card` components, one per event. Filters are a prefix
`<Select>`, a tier `<Select>`, and a free-text `<Input>`. The typed detail renderers
(`DETAIL_RENDERERS`, 11 entries: planning, queue, scheduler, message, process, agent, rule, bus,
api, workflow-* ) and `RawPayloadView` already exist and are reused as-is.

This brainstorm covers a **frontend-only** enhancement layered on the existing backend work tracked
in `.spur/run/observability-system-events-*.md` (catalog, tap, SSE delivery). No backend contract
change is required: the liveness strip and events/60s rate are derivable client-side from the
existing history fetch + SSE tail; the prefix color map is a pure client-side module.

**Scope (in):**

- Dense sortable table (column headers: time, event, actor, tier; rows clickable/keyboard-expandable).
- Event name color keyed by prefix via a **stable prefix→Tailwind color map** (not a hash).
- Expandable row details reusing existing `EventDetails` + `RawPayloadView` (no renderer rewrite).
- Liveness status strip: SSE pulse indicator, events/60s rate, N of M shown.
- Redesigned filter bar: prefix multi-select pill chips (double as color legend), tier 3-button
  segmented toggle, search with inline scope selector, live time-window quick filter,
  clear-filters, inline result count.
- Tooltip on hover/focus: compact typed detail summary (keyboard-triggerable).
- WCAG: color not sole signal, keyboard-triggerable tooltip, Enter/Space row expand, 2-column
  stacked layout <640px.

**Scope (out — preserved as-is):**

- `HISTORY_LIMIT=100` cap-and-prune.
- Untrusted-payload runtime narrowing (`parseHistoryRow`, `parseSseEnvelope`, `parseCatalog`).
- SSE malformed-frame silent drop and `connected`-frame drop.
- `/api/events/history` and `/api/events/planning` endpoints.
- `EventCatalogEntry` wire shape, `SystemEventRow` wire shape, `DETAIL_RENDERERS` registry.
- Backend catalog/tap work (separate tracked task).

## Approaches

### Approach A — Single-file refactor, derived state in the component (recommended)

Keep everything in `SystemEventsTab.tsx` (or a co-located `SystemEventsTable.tsx` next to it). Derive
liveness/rate/window state from the existing `events` array + a small `useEffect` ring buffer of
SSE arrival timestamps. The prefix→color map lives in a small `prefix-color.ts` module exported
from the same folder. The filter bar, tooltip, and table rows are local components.

**Trade-offs:**

- (+) Smallest blast radius — no new files outside the observability module folder.
- (+) No new dependency, no transport change, no DTO change.
- (+) Liveness and rate derive from state already in the component; no new fetch.
- (+) Easiest to test — one test file, happy-dom integration as today.
- (-) `SystemEventsTab.tsx` grows (estimated +250–350 lines for table, filter bar, tooltip, strip).
  Mitigate by extracting `PrefixChipBar`, `LivenessStrip`, `EventsTable`, `EventRow`,
  `EventTooltip` as local components in the same file or sibling files within the folder.
- (-) Rate window logic lives in the component; must be carefully unit-tested for off-by-one and
  purge timing.

**Confidence: HIGH.** All primitives (React state, existing renderers, Tailwind/daisyUI tokens)
are verified present in the repo today (SystemEventsTab.tsx:1-635, global.css, Badge.tsx). No
external API behavior assumed.

**Sources:**

- apps/web/src/modules/observability/SystemEventsTab.tsx:1-635 (existing component, renderers,
  parsers, SSE handling) — read 2026-07-07.
- apps/web/src/styles/global.css:1-89 (Tailwind v4 + daisyUI 5 tokens, semantic colors) — read
  2026-07-07.
- apps/web/src/components/ui/Badge.tsx:1-47 (daisyUI color variants: neutral/primary/secondary/
  accent/ghost/info/success/warning/error/outline) — read 2026-07-07.
- apps/web/package.json:1-44 (tailwindcss 4.1.17, daisyui 5.0.29, react 19.2.1) — read 2026-07-07.

### Approach B — Extract a feature module + hook, separate presentational components

Split into `modules/observability/events-tab/` with `EventsTable.tsx`, `FilterBar.tsx`,
`LivenessStrip.tsx`, `EventTooltip.tsx`, `useEventStream.ts` hook (owns history fetch, SSE tail,
ring-buffer rate, liveness pulse), and `prefix-color.ts`.

**Trade-offs:**

- (+) Clean separation; each piece independently testable.
- (+) `useEventStream` hook is reusable if the event ledger surfaces elsewhere later.
- (-) More files, more import surface, larger diff for review.
- (-) Hook extraction forces the existing fetch/SSE logic to move out of the component; this is a
  behavior-preserving refactor that must be validated against the existing happy-dom tests.
- (-) Over-engineering risk (R2): the tab is the only consumer of this state today; a hook only
  pays off if a second consumer appears.

**Confidence: HIGH** (primitives present); **MEDIUM** that the refactor stays behavior-preserving
under the existing tests without a rewrite of the test harness.

### Approach C — Server-side rate/liveness endpoint

Add a `/api/events/stats` endpoint returning `{ sseConnected, eventsLast60s, totalShown,
totalInLedger }`; the strip subscribes to it (poll or SSE-on-the-same-stream).

**Trade-offs:**

- (+) Server-authoritative liveness; survives client reconnects cleanly.
- (-) New endpoint, new contract, new test surface — contradicts the "preserve existing endpoints,
  no backend contract change" constraint and the "frontend-only" framing.
- (-) Extra fetch/load on the server for a value derivable client-side from state already held.
- (-) Crosses the app/contracts boundary (new DTO in `packages/contracts`) — multiplies the diff.

**Confidence: MEDIUM** that the endpoint is straightforward to add; **LOW** that it is warranted
given the client-side derivability and the explicit scope-out of endpoint changes.

## Recommendation

**Approach A.** It satisfies every scope item with the smallest blast radius, no new endpoint, no
new dependency, and no DTO change. The prefix→color map is the only new module worth extracting
(`prefix-color.ts`), because it is the one piece with a realistic chance of reuse elsewhere
(Kanban, Inbox) and is trivially testable in isolation. If `SystemEventsTab.tsx` grows past a
maintainable size, Approach B's extractions become a follow-up refactor — but do not pay that cost
upfront (R2).

### Design decisions to lock before decomposition

1. **Prefix color map.** A stable `Record<string, TailwindColorToken>` for the known prefixes
   (`task`, `feature`, `workflow`, `queue`, `scheduler`, `message`, `process`, `agent`, `rule`,
   `bus`, `api`) plus an `other` fallback. Color token = a small union of Tailwind color names
   (`indigo`, `emerald`, `amber`, `sky`, `violet`, `rose`, `teal`, `cyan`, `fuchsia`, `lime`,
   `slate`). Each token maps to three classes: `dot` (w-2 h-2 rounded-full bg-<color>-500),
   `text` (text-<color>-600 dark:text-<color>-400), and `badge` (a daisyUI Badge variant or a
   custom tinted class). WCAG: color is **supplementary** — the event name text is always rendered
   in full, and the prefix dot/legend is the non-text signal.

2. **Liveness strip.** Derived client-side:
   - SSE pulse: a boolean from `EventSource` readyState (`OPEN` ⇒ green dot, `CONNECTING` ⇒ amber,
     `CLOSED` ⇒ red) — no new fetch.
   - events/60s: a ring buffer of SSE arrival timestamps in a `useRef`, purged to the last 60s on
     each arrival and on a 1s interval; the rate is `buffer.length`.
   - N of M shown: `filteredEvents.length` of `events.length` (both already in state).

3. **Sortable table.** Column sort state is local (`'time' | 'event' | 'actor' | 'tier'`,
   asc/desc); default newest-first (time desc). Sorting is pure client-side over the bounded
   `events` array (≤100 rows) — no virtualization needed.

4. **Row expand.** Click or Enter/Space toggles a `<tr>`-spanning detail panel rendering
   `EventDetails` + `RawPayloadView` (both reused unchanged). ARIA: `aria-expanded` on the row
   button; the detail panel is a sibling row with `colspan`.

5. **Tooltip.** Renders a compact typed summary (the first 2–3 `DetailRow`s the renderer would
   emit) on hover **and** focus. Keyboard triggerable via `aria-describedby` and focus moving to
   the summary container. Pure CSS/React — no new dependency.

6. **Filter bar.**
   - Prefix: multi-select pill chips, one per known prefix, each carrying its color dot (legend
     + filter in one). Toggle selects/deselects; "All" is the empty selection (no chips active).
   - Tier: 3-button segmented toggle (`All` / `Default` / `Diagnostic`) — replaces the `<Select>`.
   - Search: single `<Input>` with an inline scope selector (`Name` | `Actor` | `Payload` | `All`)
     as a small attached `<Select>` — preserves the existing name/actor/payload search.
   - Time-window quick filter: `Last 60s` | `Last 5m` | `Off` — client-side comparison against
     `occurredAt`.
   - Clear-filters: one button resets all four filters to defaults.
   - Inline result count: `N of M shown` text (same source as the strip's N-of-M).

7. **Responsive <640px.** 2-column stacked: time + event on row 1, actor + tier on row 2; the
   detail panel spans both columns. Filter bar wraps to a vertical stack; the chip legend scrolls
   horizontally.

### What does NOT change

- `SystemEventRow`, `EventCatalogEntry`, `HistoryResponse`, `SseEnvelope` wire shapes.
- `parseHistoryResponse`, `parseHistoryRow`, `parseCatalog`, `parseSseEnvelope` (untrusted-input
  narrowing stays byte-for-byte).
- `HISTORY_URL`, `SSE_URL`, `HISTORY_LIMIT=100`.
- `connected`-frame drop and malformed-frame silent drop.
- `DETAIL_RENDERERS` registry and `EventDetails` dispatch (reused as-is inside the detail panel).
- `RawPayloadView` (reused as-is).
- `/api/events/history` and `/api/events/planning` endpoints (no new endpoint).

## Design Summary

A frontend-only refactor of the Observability System Events tab. The existing card list becomes a
dense sortable table; the existing two-select filter row becomes a redesigned filter bar (prefix
multi-select color-legend chips, tier segmented toggle, scoped search, time-window quick filter,
clear-filters, inline count); a new liveness status strip is derived purely from existing client
state (SSE readyState + a 60s ring buffer + filtered/total counts). Event name color is keyed by
prefix via a small stable `prefix-color.ts` map (Tailwind color tokens, not a hash), with color as
a supplementary signal — the event name text remains the primary signal (WCAG). Row details reuse
the existing typed `EventDetails` + `RawPayloadView` unchanged; expansion is keyboard-triggerable
(Enter/Space). A tooltip on hover/focus shows a compact typed summary. No backend endpoint,
DTO, transport, or dependency change. The existing untrusted-payload narrowing, HISTORY_LIMIT
cap-and-prune, and SSE malformed-frame drop are preserved.

The change is concentrated in `apps/web/src/modules/observability/` (one refactored component +
one new `prefix-color.ts` module + optional sibling presentational components if the file grows
past a maintainable size). No file outside the observability module folder is touched. Tests
remain happy-dom integration tests against the rendered component, plus a small unit test for the
prefix color map and the rate-window ring buffer.

**`needs_design`: true.** Rationale: the change introduces a cross-cutting client-side convention
(the prefix→Tailwind color map) with a realistic chance of reuse in other tabs (Kanban, Inbox), and
it restructures the component's data-flow (rate ring buffer, liveness derivation, sort state,
filter composition). Neither is a single-line fix. Ties lean design: the cost of a skipped
architecture step (color map inconsistency across tabs, un-testable rate logic) exceeds the cost of
a redundant one.

## Next steps

1. Operator reviews this doc (Design Approval Gate pattern 4).
2. `idea-pipeline.yaml` consumes `.spur/run/idea-needs-design.json` (`{"needs_design": true}`) and
   routes to `system-design`.
3. After `system-design`, `sp:spec-decomposition` produces the task batch.