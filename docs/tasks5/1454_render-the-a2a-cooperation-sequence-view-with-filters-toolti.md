---
schema_version: 1
name: Render the A2A cooperation sequence view with filters, tooltips and config drawer
status: todo
template: feature-impl
created_at: 2026-11-25T23:54:35.755Z
updated_at: "2026-11-26T00:02:56.218Z"
feature_id: A821
priority: P2

dependencies: ["1452", "1453"]
estimate_hours: 10
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

- [ ] R1. The A2A tab's primary content is a CSS-grid sequence: one lifeline per participating address, one arrow per message in `(createdAt, id)` order, replies indented under their thread, self-messages as loops; more than 8 lifelines collapse into an expandable `+N` column.
- [ ] R2. Filters (agent, direction, kind, status, thread, time range from `TimeRangePresets`) drive `inbox.timeline` and round-trip through the URL query.
- [ ] R3. Lifeline header tooltips: an inbound member shows the Agent Card summary, fetched on first open, with raw JSON when pinned and a `Diagnostic` on failure; an outbound peer shows the target, `authEnv` name and set/unset, never the token.
- [ ] R4. Arrow tooltips: body excerpt, kind, status timeline (queued, claimed, delivered, read, with attempts and error), request key, UUID-only Trace link, and remote task/context/branch refs when that receipt persisted them.
- [ ] R5. The existing Members content moves into a collapsed Configuration disclosure with no capability loss; the no-inbound-member warning stays above the sequence.
- [ ] R6. `message.*` frames refetch through the oldest loaded row.
- [ ] R7. At ≤639 px the view becomes a stacked `sender → receiver · kind · status · time` list with filters and tooltips intact.
- [ ] R8. Status uses icon plus text; the empty state names `spur message send` / `a2a send`.
- [ ] R9. `docs/design/integrations-module.md` §3 A2A row and §3.1 updated from planned to current.

Out of scope: cross-project stitching (feature T); sending or replying from this view (InboxView owns actions); new server reads beyond 1452.

### Acceptance Criteria

- [ ] AC1 — A2A tab leads with a sequence view of agent cooperation (req: R1)
  - Test layers: helpers `apps/web/tests/modules/integrations/helpers.test.ts` (`assignLanes` order, reply indent, self-loop, `+N` collapse at cap 8); component `apps/web/tests/modules/integrations/integrations-module.test.tsx` (grid renders first).
- [ ] AC2 — Filters narrow the sequence view (req: R2)
  - Test layers: helpers (`encodeA2aFilters`/`decodeA2aFilters` round-trip, unknown keys dropped); component (filter change calls `inbox.timeline` with mapped input).
- [ ] AC3 — Agent lifeline tooltip shows the Agent Card summary (req: R3)
  - Test layers: component (card fetched once on first open; `Diagnostic` on non-OK; outbound shows `auth.env` name and set/unset with no token text).
- [ ] AC4 — Message arrow tooltip shows message detail (req: R4)
  - Test layers: component (excerpt, status timeline, Trace link only for UUID run ids, remote refs from `inbox.requests({messageId})` when present).
- [ ] AC5 — Configuration detail stays reachable but out of the default view (req: R5)
  - Test layers: component (drawer collapsed by default; existing Members testids still reachable when expanded; warning above grid).
- [ ] AC6 — Sequence view updates live (req: R6)
  - Test layers: component (a `message.*` planning event triggers a refetch bounded by the oldest loaded row; non-message frames ignored).
- [ ] AC7 — Compact layout falls back to a stacked list (req: R7)
  - Test layers: heavy browser proof `apps/web/tests/a2a-sequence.heavy.test.ts` (`test:heavy`, 639 px viewport → stacked rows, tooltip still opens).
- [ ] AC8 — Empty and degraded states are explicit (req: R8, R9)
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
