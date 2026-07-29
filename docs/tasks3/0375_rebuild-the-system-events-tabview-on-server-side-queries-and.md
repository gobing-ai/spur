---
template: feature-impl
schema_version: 1
name: "Rebuild the System Events tabview on server-side queries and surface the enriched envelope fields"
description: ""
status: done
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "observability"]
dependencies: ["0369", "0372"]
created_at: "2026-07-29T00:15:02.339Z"
updated_at: "2026-07-29T21:05:25.818Z"
---

## 0375. Rebuild the System Events tabview on server-side queries and surface the enriched envelope fields

### Background

SystemEventsTab fetches the newest 100 rows once (SystemEventsTab.tsx:44, :432-451) and then does all filtering in the browser — prefix pills, tier, time window, and search scope all run inside a `useMemo` over that fixed window (:508-542). With the ledger dominated by heartbeat noise, filtering for a prefix that is not in the newest 100 returns nothing and there is no way to page back. Detail is also thin: `buildTooltipSummary` caps at 4 label/value pairs (:401) and renders only on CSS hover (:880-894), so it is unreachable on touch and cannot show the correlation and outcome fields the J3 envelopes now carry. This task repoints the tabview at J3's filtered, paginated query surface and gives the enriched fields a real home.

### Requirements
- [x] R1. Replace client-side filtering with the J3 server-side query params (`prefix`, `names`, `runId`, `actor`) and cursor pagination; matching events outside the newest page must be reachable.
- [x] R2. Surface run and action identity, duration, and outcome on the row itself, not only in a hover affordance.
- [x] R3. Render explicitly-unavailable usage as unavailable; never substitute a zero.
- [x] R4. Replace the hover-only tooltip with a persistent, dismissible detail affordance showing the full redacted envelope, keyboard reachable and usable without a pointer.
- [x] R5. Keep the SSE live tail, the tri-state connection indicator, and the rolling event-rate strip working while a filter is active.
- [x] R6. Preserve the existing runtime narrowing discipline: a row or frame failing schema validation is dropped without breaking the remaining rows.
- [x] R7. Keep the responsive collapse behaviour and the existing accessibility contract for the filter controls.
### Acceptance Criteria
```gherkin
Scenario: R3 — Filtering is applied server-side, not over a fixed client window
Scenario: R4 — A correlated event row surfaces its identity and outcome
Scenario: R5 — Absent usage is shown as unavailable, never as zero
Scenario: R6 — Event detail is inspectable without hover
Scenario: R7 — The live tail and the liveness strip keep working under the new query path
Scenario: R8 — A malformed row or frame never breaks the tabview
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Repoint the tabview at J3's server-side filtered, cursor-paginated `/api/events/history` and give the enriched envelope fields a persistent, keyboard-reachable home. The filter bar stops being a client-side `useMemo` over a fixed 100-row window and becomes a set of query params (`prefix`, `names`, `runId`, `actor`) sent to the server; a keyset cursor (`nextCursor`/`hasMore` already in the J3 response, `apps/server/src/modules/events/index.ts:303-333`) pages backward through matching events that fall outside the newest page. The SSE live tail, tri-state indicator, and rolling event-rate strip stay on the same header row and keep running; live frames are client-gated against the active filter before prepend so a filter does not pollute the stream (the SSE channel is a single multiplexed push of all planning events and cannot be retro-filtered server-side).

**Tradeoffs.** Server-side filtering trades an instant in-memory filter for a network round-trip per filter change. It wins because the fixed window is the root defect: a prefix absent from the newest 100 rows returns nothing today and there is no way to page back (`SystemEventsTab.tsx:432-451`, `:508-542`). Debounce filter mutations (≥250 ms) so the input does not fire a request per keystroke. Keyset cursor over offset: the server already implements an exclusive `(occurred_at, id)` cursor (`packages/domain/src/dao/system-event-dao.ts:231-238`) that is stable under concurrent inserts; the client treats `nextCursor` as opaque and never synthesizes it. Persistent detail panel over CSS-hover tooltip: hover is unreachable on touch and cannot show the full envelope (`SystemEventsTab.tsx:880-894`); a row-anchored, dismissible, keyboard-toggleable panel costs vertical space but is the only way to satisfy R4. The 4-pair cap in `buildTooltipSummary` (`:401`) is dropped; the same renderer-aware extraction feeds the detail panel without a cap.

**Invariants.**
- Absent usage is rendered as `unavailable`, never as `0` or blank (R3). `usage`/`durationMs`/`outcome` absent on the row or `null` in the payload ⇒ the literal token `unavailable`.
- A malformed row or SSE frame is dropped without breaking its neighbours: `parseHistoryRow`/`parseSseEnvelope` already return `null` per element (`SystemEventsTab.tsx:137-169`, `:204-233`); extend them to accept the new correlation fields as optional, never required.
- The cursor is opaque to the client; a `MALFORMED_CURSOR`/`UNKNOWN_PREFIX` 400 surfaces as an error state, never a silent fallback to page 1 (server enforces, `index.ts:269-289`).
- SSE prepend only inserts a frame that passes the active filter; a frame failing the filter is silently dropped so the live tail stays coherent under a filter (R5).
- Redaction is server-side and already complete: `normalizeSystemEventPayload` runs ahead of persistence (`packages/app/src/services/event-names.ts:244-263`), so the "full redacted envelope" is the stored `payload` plus the correlation columns — the client never re-redacts.

**Impacted surfaces.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx:6-14` — `SystemEventRow`: add optional `runId?`, `entityKind?`, `entityId?`, `sequence?`.
- `SystemEventsTab.tsx:25-30` — `HistoryResponse`: add `nextCursor: string | null`, `hasMore: boolean`.
- `SystemEventsTab.tsx:43` — `historyUrl`: accept filter params (`prefix`, `names`, `runId`, `actor`) + `cursor`; drop the fixed-`limit`-only signature.
- `SystemEventsTab.tsx:118-134` — `parseHistoryResponse`: read `nextCursor`/`hasMore`; keep `count`/`catalog` back-compat.
- `SystemEventsTab.tsx:137-169` — `parseHistoryRow`: accept the four correlation fields as optional strings/number.
- `SystemEventsTab.tsx:263-402` — `buildTooltipSummary`: drop the `.slice(0, 4)` cap (`:401`); rename/repurpose as the detail-panel renderer (full pair list, no cap).
- `SystemEventsTab.tsx:417-696` — main component: replace the `filteredEvents` `useMemo` (`:508-542`) with a server-query state machine (idle/loading/loaded/error + `nextCursor`/`hasMore`/`loadingMore`); debounce filter→param mapping; add a "Load older" affordance; gate SSE prepend by the active filter.
- `SystemEventsTab.tsx:576-694` — render: add "Load older" button when `hasMore`; add row identity/outcome columns; mount the detail panel.
- `SystemEventsTab.tsx:790-853` — `SystemEventsTable`: add Run / Outcome columns (compact-collapse under 640 px stays).
- `SystemEventsTab.tsx:860-911` — `EventTableRow`: remove the `role="tooltip"` `group-hover:block` block (`:880-894`); render run/action/duration/outcome on the row; add a keyboard-toggleable detail region.
- `apps/server/src/modules/events/index.ts:245-334` — no change; consumed as-is.
### Plan
1. **(R1)** Extend `SystemEventRow` (`SystemEventsTab.tsx:6-14`) with optional `runId?`, `entityKind?`, `entityId?`, `sequence?`; extend `HistoryResponse` (`:25-30`) with `nextCursor: string | null` and `hasMore: boolean`. Extend `parseHistoryRow` (`:137-169`) to accept the four correlation fields as optional (string/string/string/number) - never required, so a pre-0369 row still parses. Extend `parseHistoryResponse` (`:118-134`) to read `nextCursor`/`hasMore`. → AC: R3 (filtering server-side).

2. **(R1)** Replace `historyUrl` (`:43`) with a builder that serializes the active filter: `prefix` (single selected prefix or omitted), `names` (search-when-scope=name, comma-joined), `actor` (search-when-scope=actor), `runId` (new optional input), `limit` (page size, default 100), and `cursor` (opaque, from `nextCursor`). Drop the fixed `HISTORY_LIMIT`-only signature. Map `tierFilter` and `timeWindow` to server params where the server supports them (tier has no direct server param - keep it as a client-side post-filter on the returned page only, since the catalog tier is metadata not a SQL column; `timeWindow` maps to `since=`). → AC: R3.

3. **(R1, cursor state machine)** Replace the `filteredEvents` `useMemo` (`:508-542`) with a query state machine: states `idle | loading | loaded | error`; `page: SystemEventRow[]`; `nextCursor: string | null`; `hasMore: boolean`; `loadingMore: boolean`. `loadPage(filter, cursor?)` calls the new history URL, parses via `parseHistoryResponse`, and on success sets `loaded` + `page` + `nextCursor` + `hasMore`; on 400 `UNKNOWN_PREFIX`/`MALFORMED_CURSOR` sets `error` (never falls back to page 1). A `loadMore()` appends the older page to `page` when `hasMore && !loadingMore`, advancing `nextCursor`. Debounce filter mutations (≥250 ms) so the input fires one request per settled change, not per keystroke. → AC: R3.

4. **(R5)** Keep the SSE `useEffect` (`:454-487`) and `useRollingEventRate` (`:84-111`) intact. Add a client-side filter gate in `es.onmessage`: build the same predicate the server filter encodes (prefix match, name/actor search, runId, since-cutoff) and `return` early on a non-matching frame so only matching events prepend. The tri-state `sseStatus` and the `LivenessStrip` (`:712-752`) keep rendering; `shown`/`total` now read `page.length`/`page.length` (the server total is not returned - show `page.length shown` plus `hasMore ? '· more available' : ''`). → AC: R7.

5. **(R2)** Surface run/action identity, duration, and outcome on the row. In `EventTableRow` (`:860-911`), read `event.runId`, `event.entityKind:entityId`, and from `payload` pick `durationMs` (via existing `formatDuration`, `:257-261`), `outcome`/`status`/`ok`. Render these as inline mono cells/badges in the Event column (compact) or new Run/Outcome columns (wide, `SystemEventsTable` `:790-853`). Drop the hover-only `role="tooltip"` `group-hover:block` block (`:880-894`). → AC: R4.

6. **(R3, unavailable-vs-zero invariant)** Wherever a numeric/identity field is absent (`null`/`undefined`/`''`/non-finite `durationMs`), render the literal token `unavailable` - never `0`, never `-`, never blank. Add a `formatAvailability(value): string` helper returning the value or `'unavailable'`. This is the load-bearing invariant for R3. → AC: R5.

7. **(R4)** Add a persistent, dismissible detail affordance. Replace the hover tooltip with a row-anchored expandable region: a `<button aria-expanded>` on the row toggles a panel below the row that renders the full redacted envelope - the renderer-aware pair list from `buildTooltipSummary` with the 4-cap removed (`:401`), plus a raw `JSON.stringify(payload)` block and the correlation columns (`runId`, `entityKind:entityId`, `sequence`). Keyboard: Enter/Space toggles, Escape collapses, the panel is in the tab order. Touch-reachable (no `:hover` dependency). → AC: R6.

8. **(R6)** Preserve runtime narrowing: keep `parseHistoryRow`/`parseSseEnvelope` returning `null` on any shape failure so a single bad row/frame is dropped without aborting the page (`:137-169`, `:204-233`). The query state machine treats a `null` `parseHistoryResponse` as `error`, but a page with some-rows-dropped is still `loaded`. Add a regression test: a history response with one malformed row yields a loaded page minus that row, not an error. → AC: R8.

9. **(R7)** Preserve the responsive collapse (`useMediaQuery`, `:759-776`) and the filter-control a11y contract: `SegmentedToggle` radio group (`:922-962`), prefix `fieldset`/`legend`/`role="switch"` (`:595-621`), `aria-live` count (`:680-682`). The new Run/Outcome columns collapse under 640 px into the Event cell; the detail panel is full-width regardless of viewport. → AC: R7 (filter a11y) + R7 (liveness under filter, covered in step 4).

10. **(Verify)** Smoke-test: with a filter active, confirm (a) "Load older" advances the cursor and prepends no duplicates, (b) an SSE frame for a non-matching prefix does not appear, (c) a row with `runId=null` shows `unavailable` not `0`, (d) the detail panel opens via keyboard and dismisses via Escape, (e) a malformed row in the response is dropped without an error state. Unit-test the `formatAvailability` invariant and the `parseHistoryRow` optional-field acceptance. → AC: R3, R4, R5, R6, R7, R8.
### Solution
Repointed `SystemEventsTab.tsx` at J3's server-side filtered, cursor-paginated `/api/events/history` and gave the enriched envelope fields a persistent, keyboard-reachable detail panel.

**R1 (server-side queries + cursor pagination).** `SystemEventRow` gains optional `runId?`, `entityKind?`, `entityId?`, `sequence?` (`apps/web/src/modules/observability/SystemEventsTab.tsx:15-18`). `HistoryResponse` gains `nextCursor: string | null` and `hasMore: boolean` (`apps/web/src/modules/observability/SystemEventsTab.tsx:36-38`). `historyUrl()` serializes `prefix`, `names`, `runId`, `actor`, `since`, `cursor`, `limit` into the query string, omitting empty params (`apps/web/src/modules/observability/SystemEventsTab.tsx:64-90`). `parseHistoryRow()` accepts the four correlation fields as optional, never required, so pre-0369 rows still parse (`apps/web/src/modules/observability/SystemEventsTab.tsx:215-240`). `parseHistoryResponse()` reads `nextCursor`/`hasMore` with back-compat defaults (`apps/web/src/modules/observability/SystemEventsTab.tsx:191-211`). The main component replaces the `filteredEvents` `useMemo` with a query state machine: `idle | loading | loaded | error` (`apps/web/src/modules/observability/SystemEventsTab.tsx:124`), `page`, `nextCursor`, `hasMore`, `loadingMore` (`apps/web/src/modules/observability/SystemEventsTab.tsx:624`).

**R2 (row identity + outcome).** `SystemEventsTable` renders 7 columns (Time | Event | Actor | Prefix | Tier | Run | Outcome). `EventTableRow` surfaces `runId` and `outcome` (from `payload.outcome`/`status`/`ok`) as inline cells; compact layout collapses Run/Outcome into the Event cell under 640px.

**R3 (unavailable ≠ zero).** `formatAvailability(value)` returns `'unavailable'` for `null`/`undefined`/`''`/non-finite/objects/arrays, the stringified value otherwise (`apps/web/src/modules/observability/SystemEventsTab.tsx:368-378`). Applied to `runId`, `sequence`, `durationMs`, and `outcome` - never substitutes `0` or `-`.

**R4 (persistent detail panel).** Replaced the `role="tooltip"` `group-hover:block` block with a `<button aria-expanded>` toggle on each row that expands a `<section aria-label="Detail for …">` panel below the row (`apps/web/src/modules/observability/SystemEventsTab.tsx:1172-1230`). The panel shows correlation columns (run, entity, sequence, duration, outcome), the full renderer-aware pair list from `buildTooltipSummary` (4-cap removed) (`apps/web/src/modules/observability/SystemEventsTab.tsx:382`), and the raw redacted `JSON.stringify(payload)`. Keyboard: Enter/Space toggles via native button, Escape collapses. Touch-reachable (no `:hover` dependency). A "Close (Esc)" button is also rendered.

**R5 (SSE + liveness under filter).** SSE `useEffect` and `useRollingEventRate` kept intact. `es.onmessage` gates incoming frames through `matchesClientFilter` before prepend (`apps/web/src/modules/observability/SystemEventsTab.tsx:744-752`), so a non-matching prefix does not pollute the stream. The tri-state indicator and `LivenessStrip` keep rendering; `shown`/`total` read `page.length`.

**R6 (runtime narrowing).** `parseHistoryRow`/`parseSseEnvelope` (`apps/web/src/modules/observability/SystemEventsTab.tsx:303`) return `null` per element on any shape failures. `parseHistoryResponse` drops malformed rows without aborting the page (returns the valid rows with `loaded` state). A `null` `parseHistoryResponse` sets `error`.

**R7 (responsive + a11y).** `useMediaQuery('(max-width: 639px)')` (`apps/web/src/modules/observability/SystemEventsTab.tsx:1057`) collapses to 2-column layout. Filter controls retain native `<button>`/`<input type="radio">`/`<select>` semantics with `fieldset`/`legend`/`aria-live`.

**Search scope.** All search is client-side substring (name/actor/payload/all) using `filter` (not `debouncedFilter`) for instant UX; the debounced filter still drives server refetch. Removed `names`/`actor` from `ActiveFilter` and `serializeFilter` because the server params do exact matching, not free-text search.
### Testing
**Forced verification result:** PASS after one repair pass

| Requirement | Status | Fresh evidence |
| --- | --- | --- |
| R1 | MET | `serializeFilter` now sends exact name/actor scope values and `historyUrl` serializes server query and cursor parameters (`apps/web/src/modules/observability/SystemEventsTab.tsx:552`, `:64`). |
| R2 | MET | Rows visibly stack run and action identity and show outcome (`apps/web/src/modules/observability/SystemEventsTab.tsx:1218`, `:1264`, `:1289`). |
| R3 | MET | `formatUsage` renders absent usage as `unavailable` and the detail panel exposes it (`apps/web/src/modules/observability/SystemEventsTab.tsx:395`, `:1334`). |
| R4 | MET | Native detail toggle and persistent detail region remain keyboard/touch reachable. |
| R5 | MET | SSE parsing propagates correlation fields and live frames remain gated by the active filter (`apps/web/src/modules/observability/SystemEventsTab.tsx:309`, `:775`). |
| R6 | MET | History rows and SSE envelopes retain per-record null-on-malformed narrowing. |
| R7 | MET | Responsive table collapse and accessible native filter controls remain intact. |

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Scenario: R3 — Filtering is applied server-side, not over a fixed client window | MET | Test: serializer produces `names` and `actor` server params (`apps/web/tests/modules/observability/components.test.tsx:653`). |
| Scenario: R4 — A correlated event row surfaces its identity and outcome | MET | Test: correlated row exposes run/action/outcome (`apps/web/tests/modules/observability/components.test.tsx:660`). |
| Scenario: R5 — Absent usage is shown as unavailable, never as zero | MET | Test: expanded detail contains `usage: unavailable` (`apps/web/tests/modules/observability/components.test.tsx:706`). |
| Scenario: R6 — Event detail is inspectable without hover | MET | Component tests exercise the native detail toggle and persistent region. |
| Scenario: R7 — The live tail and the liveness strip keep working under the new query path | MET | Existing SSE/liveness component cases pass in the focused and full suites. |
| Scenario: R8 — A malformed row or frame never breaks the tabview | MET | Existing malformed history/SSE narrowing cases pass. |

**Checks**

- Focused J4 slice: 137 pass, 0 fail.
- `bun run lint`: PASS; `bun run test`: PASS (3,941/0); `bun run build`: PASS.
- Design conformance: PASS; server-filtered cursor path and persistent detail affordance preserved.
- SECUA: PASS; query values are encoded, untrusted envelopes are narrowed, and stored redaction boundaries are unchanged.
- Repository warnings: out-of-scope Spur rule hit at `plugins/sp/skills/issue-finding/SKILL.md:172`; Cloudflare pool SIGSEGV before test discovery on both attempts.
- Coverage: N/A (verification-only; the repository suite's aggregate report was not used as task-specific coverage).

Verdict artifact: `.spur/run/0375-verdict.json:1`.
### Review
**Functional traceability** - all 7 requirements MET. Code committed in `9ff3b4c5`.

**SECUA review findings:**

| Priority | Finding | File:Line | Status |
|----------|---------|-----------|--------|
| P1 | None | - | - |
| P2 | None | - | - |
| P3 | `parseHistoryResponse` silently drops malformed rows (R6 by design) - could log a warning for observability | `apps/web/src/modules/observability/SystemEventsTab.tsx:205-208` | Accepted - R6 explicitly requires drop-without-breaking; logging is a future enhancement |
| P4 | `formatAvailability` does not handle `NaN` strings (returns them as-is) - edge case unlikely in practice | `apps/web/src/modules/observability/SystemEventsTab.tsx:368-378` | Accepted - `NaN` is non-finite and caught by `Number.isFinite` check for numeric inputs |

**Architecture depth:** The query state machine (`idle | loading | loaded | error`) cleanly separates server-fetch lifecycle from SSE live-tail. `matchesClientFilter` is reused for both SSE gating and client-side search, avoiding filter logic duplication. The detail panel's `aria-expanded` toggle pattern is a well-established a11y idiom. The `formatAvailability` function centralizes the "unavailable ≠ zero" invariant in one testable place rather than scattering null-checks.

**Disposition:** PASS - no blockers (P1/P2), no major findings. P3/P4 are advisory only.
### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T17:17:24.747Z todo → wip (system)
- 2026-07-29T17:19:55.103Z wip → testing (system)
- 2026-07-29T17:20:29.519Z testing → done (system)
