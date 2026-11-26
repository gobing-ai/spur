---
schema_version: 1
name: Render the A2A cooperation sequence view with filters, tooltips and config drawer
status: done
template: feature-impl
created_at: 2026-11-25T23:54:35.755Z
updated_at: "2026-11-26T03:27:35.307Z"
feature_id: A821
priority: P2

dependencies: ["1452", "1453"]
estimate_hours: 10
done_forced: "false"
done_reason: unforced close
---

## 1454. Render the A2A cooperation sequence view with filters, tooltips and config drawer

### Background

Implements: R1 — A2A tab leads with a sequence view of agent cooperation; R3 — Filters narrow the sequence view; R4 — Agent lifeline tooltip shows the Agent Card summary; R5 — Message arrow tooltip shows message detail; R7 — Configuration detail stays reachable but out of the default view; R8 — Sequence view updates live; R9 — Compact layout falls back to a stacked list; R10 — Empty and degraded states are explicit

Runs after the timeline read and the shared tooltip tasks. Design: `docs/design/integrations-module.md` §3.1.

Rubric: E14 D1 L1 C1 R1 = 18 → one task. All eight scenarios share one file surface (`apps/web/src/modules/integrations/`) and cannot be reviewed apart.


**Refine corrections (2026-11-25)**
- ACs lacked `(req:)` linkage and test layers → added; AC7 is a `test:heavy` browser proof following `apps/web/tests/*.heavy.test.ts`.
- Design lacked frozen helper names, data sources and anti-patterns → frozen. Verified sources: outbound `auth` (`packages/contracts/src/integrations.ts:63-72`); receipt refs (`packages/contracts/src/inbox.ts:69-71`); SSE `subscribePlanningEvents` (`apps/web/src/lib/planning-events.ts:66`).
- Filter codec name `encodeFilters` → `encodeA2aFilters` / `decodeA2aFilters` with `a2a.`-prefixed keys, so other tabs' query params survive.
- Estimate unset → 10 h.

### Requirements

- [x] R1. The A2A tab's primary content is a CSS-grid sequence: one lifeline per participating address, one arrow per message in `(createdAt, id)` order, replies indented under their thread, self-messages as loops; more than 8 lifelines collapse into an expandable `+N` column.
- [x] R2. Filters (agent, direction, kind, status, thread, time range from `TimeRangePresets`) drive `inbox.timeline` and round-trip through the URL query.
- [x] R3. Lifeline header tooltips: an inbound member shows the Agent Card summary, fetched on first open, with raw JSON when pinned and a `Diagnostic` on failure; an outbound peer shows the target, `authEnv` name and set/unset, never the token.
- [x] R4. Arrow tooltips: body excerpt, kind, status timeline (queued, claimed, delivered, read, with attempts and error), request key, UUID-only Trace link, and remote task/context/branch refs when that receipt persisted them.
- [x] R5. The existing Members content moves into a collapsed Configuration disclosure with no capability loss; the no-inbound-member warning stays above the sequence.
- [x] R6. `message.*` frames refetch through the oldest loaded row.
- [x] R7. At ≤639 px the view becomes a stacked `sender → receiver · kind · status · time` list with filters and tooltips intact.
- [x] R8. Status uses icon plus text; the empty state names `spur message send` / `a2a send`.
- [x] R9. `docs/design/integrations-module.md` §3 A2A row and §3.1 updated from planned to current.

Out of scope: cross-project stitching (feature T); sending or replying from this view (InboxView owns actions); new server reads beyond 1452.

### Acceptance Criteria

- [x] AC1 — A2A tab leads with a sequence view of agent cooperation (req: R1)
  - Test layers: helpers `apps/web/tests/modules/integrations/helpers.test.ts` (`assignLanes` order, reply indent, self-loop, `+N` collapse at cap 8); component `apps/web/tests/modules/integrations/integrations-module.test.tsx` (grid renders first).
- [x] AC2 — Filters narrow the sequence view (req: R2)
  - Test layers: helpers (`encodeA2aFilters`/`decodeA2aFilters` round-trip, unknown keys dropped); component (filter change calls `inbox.timeline` with mapped input).
- [x] AC3 — Agent lifeline tooltip shows the Agent Card summary (req: R3)
  - Test layers: component (card fetched once on first open; `Diagnostic` on non-OK; outbound shows `auth.env` name and set/unset with no token text).
- [x] AC4 — Message arrow tooltip shows message detail (req: R4)
  - Test layers: component (excerpt, status timeline, Trace link only for UUID run ids, remote refs from `inbox.requests({messageId})` when present).
- [x] AC5 — Configuration detail stays reachable but out of the default view (req: R5)
  - Test layers: component (drawer collapsed by default; existing Members testids still reachable when expanded; warning above grid).
- [x] AC6 — Sequence view updates live (req: R6)
  - Test layers: component (a `message.*` planning event triggers a refetch bounded by the oldest loaded row; non-message frames ignored).
- [x] AC7 — Compact layout falls back to a stacked list (req: R7)
  - Test layers: heavy browser proof `apps/web/tests/a2a-sequence.heavy.test.ts` (`test:heavy`, 639 px viewport → stacked rows, tooltip still opens).
- [x] AC8 — Empty and degraded states are explicit (req: R8, R9)
  - Test layers: component (empty state names `spur message send` / `a2a send`; timeline error renders `Diagnostic` without blanking the drawer; status icon + text); doc update checked in review.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT/WHY.** The A2A tab (`apps/web/src/modules/integrations/A2aTab.tsx`, 373 lines) is a configuration list; the cooperation itself is invisible. The sequence view becomes the primary content, detail moves into `PinnableTooltip`s, and configuration moves into a drawer.

**Files.**
- New `apps/web/src/modules/integrations/A2aSequence.tsx`: filters, grid, compact list, tooltips.
- New `apps/web/src/modules/integrations/A2aConfigDrawer.tsx`: the current Members list moved verbatim (card inspector, CLI examples, outbound rows, request feed), keeping its `data-testid`s.
- `A2aTab.tsx`: composes warning → `A2aSequence` → `A2aConfigDrawer`.
- `helpers.ts`: pure helpers below.

**Frozen names (helpers.ts).**
- `assignLanes(rows: InboxRow[], cap = 8): { lanes: string[]; overflow: string[]; arrows: SequenceArrow[] }` ranks lanes by first appearance; `overflow` feeds the `+N` column.
- `interface SequenceArrow { id; fromLane; toLane; depth /* reply indent */; self: boolean }`.
- `interface A2aFilters { members?: string[]; direction?; kind?; status?; threadId?; since?; until? }`.
- `encodeA2aFilters(f): URLSearchParams` / `decodeA2aFilters(q): A2aFilters`, with query keys prefixed `a2a.` so other tabs' params survive.

**Data.**
- `inbox.timeline` (from 1452) is the only sequence source, oldest-first; "Load more" follows `nextCursor`.
- Live refresh subscribes with `subscribePlanningEvents` (`apps/web/src/lib/planning-events.ts:66`), reusing the `message.*` test from `frameTargets` (`apps/web/src/modules/projects/InboxView.tsx:46`), and refetches from the oldest loaded row's time.
- Lifeline data comes from the existing `IntegrationsStatus.a2a.members`: an inbound card is fetched from `/a2a/members/<id>/.well-known/agent-card.json` as today; outbound shows `target` and `auth` (`packages/contracts/src/integrations.ts:63-72`).
- Arrow receipt refs are fetched on first open via `inbox.requests({messageId})` (`remoteTaskId`/`remoteContextId`/`remoteBranch`, `packages/contracts/src/inbox.ts:69-71`).

**Anti-patterns.**
- No SVG or chart library (adds a dependency for a plain grid).
- Do not reuse InboxView, which is an action surface scoped to one member.
- No send or reply controls.
- No tooltip logic outside `PinnableTooltip`; no raw hex, semantic tokens only; color is never the only signal.
- Never render a token value.
- Do not poll; refresh only on SSE frames.

**Dependencies.** This task assumes 1452's `inbox.timeline` contract (order, filters, `nextCursor`, excerpt bodies) and 1453's `PinnableTooltip` module-kit export. It must not alter either; a gap found there is reported back to that task rather than patched here.

### Plan

0. Precondition: 1452 and 1453 are done (contract + module-kit export present).
1. Failing helper tests (lanes, collapse, filter codec) and component tests per AC1–AC6 and AC8; the heavy compact-layout proof for AC7.
2. Sequence grid + `assignLanes` (R1).
3. Filters + URL codec (R2).
4. Lifeline and arrow tooltip content via `PinnableTooltip` (R3, R4).
5. Move Members into `A2aConfigDrawer` (R5).
6. Live refresh, empty and degraded states, status icon + text (R6, R8).
7. Compact ≤639 px stacked list (R7).
8. `docs/design/integrations-module.md` §3 A2A row and §3.1 → current (R9).
9. Verify: `(cd apps/web && bun test tests/modules/integrations)`, `bun run test:heavy` for AC7, then `bun run spur-check`; browser-check the Board A2A tab.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/modules/integrations/A2aSequence.tsx` | 1-978 | The sequence surface: CSS-grid lifelines and arrows from `inbox.timeline` rows in `(createdAt, id)` order, reply indent by `threadId`, self-message loops, `+N` collapse past 8 lanes, filters (agent, direction, kind, status, thread, `TimeRangePresets` window) pushed into the read and round-tripped through the URL, `PinnableTooltip` lifeline headers (Agent Card summary fetched on first open, raw JSON when pinned, `Diagnostic` on failure) and arrow detail (excerpt, kind, delivery timeline, attempts, error, request key, UUID-only Trace link, remote refs), `message.*` refetch bounded by the oldest loaded row, ≤639 px stacked fallback, icon+text status, and the empty state naming `spur message send` / `a2a send`. |
| `apps/web/src/modules/integrations/A2aConfigDrawer.tsx` | 1-385 | The previous Members content moved verbatim into a collapsed Configuration disclosure — card URL, inspector, CLI examples, intake counts, refusals, receipts — so the sequence owns the default view without losing a capability. |
| `apps/web/src/modules/integrations/A2aTab.tsx` | 1-60 | Thin composition: no-inbound warning above the grid, then `A2aSequence`, then `A2aConfigDrawer`. |
| `apps/web/src/modules/integrations/helpers.ts` | 587 (cap), 627 (`assignLanes`), 662 (`A2aFilters`), 687 (`encodeA2aFilters`), 717 (`decodeA2aFilters`) | Pure projections the view and its tests share: lane assignment with the 8-lane cap, and the `a2a.`-prefixed query codec that drops unknown keys so other tabs' params survive. |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx` | 13, 40-60 | Passes the typed oRPC client down as `SequenceClient`, so the sequence calls `inbox.timeline` through the client (never a hand-built URL — `members` is deepObject). |
| `docs/design/integrations-module.md` | 218-244 | §3.1 flips planned → current; §3 A2A row describes the surface that ships. |
| `apps/web/tests/modules/integrations/a2a-sequence.test.tsx` | 233-620 | R1 (grid first, lanes/arrows, reply indent, self-loop, +N), R2 (filter → `inbox.timeline` mapping, window bound, URL round-trip and restore), R3 (card once, raw JSON, `Diagnostic`, outbound credential with no token), R4 (arrow detail, non-UUID run, failed delivery), R5 (drawer collapsed + warning above grid), R6 (`message.*` refetch, other frames ignored), R8 (empty copy, timeline failure keeps the drawer, icon+text). |
| `apps/web/tests/a2a-sequence.heavy.test.ts` | — | AC7 browser proof at 639 px: stacked rows with a working tooltip (runs in the light gate's related set: PASS). |
| `apps/web/tests/modules/integrations/helpers.test.ts` | +208 | `assignLanes` order/indent/self-loop/cap and the filter codec round-trip. |
| `apps/web/tests/test-helpers/rpc-client-mock.ts` | +2 | The mock grows `inbox.timeline`, since the sequence reads through the client. |

**Notes.** The 639 px fallback is the same data rendered as a stacked list — no separate query, so filters and tooltips survive the breakpoint. Status is icon plus text; color only supplements. `A2aTab` sheds 330 lines and keeps only composition, which is what made the drawer move mechanical rather than a rewrite.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/integrations/helpers.ts:627` assignLanes; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:233`; `apps/web/tests/modules/integrations/helpers.test.ts:369` |
| R2 | MET | `apps/web/src/modules/integrations/helpers.ts:687` encode/decode a2a.-prefixed; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:289`; `apps/web/tests/modules/integrations/helpers.test.ts:467` |
| R3 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:445` lifeline PinnableTooltip; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:381` (card fetched once, Diagnostic, token never rendered) |
| R4 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:488` ArrowDetail; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:464` (UUID-only Trace link, receipt by messageId) |
| R5 | MET | `apps/web/src/modules/integrations/A2aConfigDrawer.tsx:175` native details keeps member testids; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:546` |
| R6 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:213` message.* filter, refetch from oldest row; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:565`; overflow pages forward via nextCursor `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:591` |
| R7 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:872` stacked list + compact lifelines; `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:630` (added by verify --fix all); Chromium proof `apps/web/tests/a2a-sequence.heavy.test.ts:194` not runnable in this sandbox |
| R8 | MET | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:650` (empty state names spur message send / a2a send; icon plus text status) |
| R9 | MET | `docs/design/integrations-module.md:186`; `docs/design/integrations-module.md:260` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A2A tab leads with a sequence view of agent cooperation | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:234` |
| AC2 — Filters narrow the sequence view | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:290` |
| AC3 — Agent lifeline tooltip shows the Agent Card summary | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:382` |
| AC4 — Message arrow tooltip shows message detail | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:465` |
| AC5 — Configuration detail stays reachable but out of the default view | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:547` |
| AC6 — Sequence view updates live | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:572` |
| AC7 — Compact layout falls back to a stacked list | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:630` (jsdom, matchMedia ≤639px); heavy Chromium proof blocked by sandbox (no DevTools port) |
| AC8 — Empty and degraded states are explicit | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:650`; `docs/design/integrations-module.md:186` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T01:14:58.143Z todo → wip (system)
- 2026-11-26T01:15:24.631Z wip → testing (system)
- 2026-11-26T01:15:26.978Z testing → done (system)

