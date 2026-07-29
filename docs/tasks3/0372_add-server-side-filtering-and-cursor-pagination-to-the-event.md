---
template: feature-impl
schema_version: 1
name: "Add server-side filtering and cursor pagination to the event history query surface"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "api", "data-plane"]
dependencies: ["0369"]
created_at: "2026-07-29T00:14:03.033Z"
updated_at: "2026-07-29T04:50:57.445Z"
---

## 0372. Add server-side filtering and cursor pagination to the event history query surface

### Background

GET /api/events/history accepts only `name`, `since`, and `limit` (apps/server/src/modules/events/index.ts:163-190), and `SystemEventDao.query` mirrors that. Consequently every Board filter — prefix pills, tier, time window, search scope in SystemEventsTab, and the queue/scheduler predicate in JobsTab — runs in the browser over whatever the newest 100 (or 50) rows happen to be. With the ledger dominated by heartbeat noise, that window rarely contains what the operator filtered for, and there is no way to page back to it. Once the correlation columns exist, these filters become cheap indexed queries; this task exposes them.

### Requirements
- [x] R1. Add `prefix`, `names` (multi-value), `runId`, and `actor` filters to `SystemEventDao.query` and to GET /api/events/history, backed by the correlation-column indexes.
- [x] R2. Add cursor-based pagination that is stable under concurrent writes — paging must not repeat an already-returned event nor skip one older than the cursor.
- [x] R3. Reject an uncataloged prefix or a malformed cursor with a client error and a reason; never silently fall back to an unfiltered result set.
- [x] R4. Preserve the existing response envelope (`events`, `count`, `catalog`) and the current `name`/`since`/`limit` behaviour for existing consumers.
- [x] R5. Keep the endpoint's `limit` ceiling and default, and apply filters in SQL rather than post-filtering a fetched page.
- [x] R6. Return the correlation fields on each row so clients can group without re-parsing payloads.
### Acceptance Criteria
```gherkin
Scenario: R18 — History can be filtered by prefix server-side
Scenario: R19 — History can be filtered by run and by actor
Scenario: R20 — History pagination is stable under concurrent writes
Scenario: R21 — An unknown prefix or malformed cursor is rejected cleanly
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Extend the existing history surface rather than a new endpoint. DAO owns SQL filter composition and exclusive keyset (`before` on `(occurred_at, id)` with `ORDER BY occurred_at DESC, id DESC`). The HTTP layer validates catalog membership for `prefix` and opaque cursor shape before any query, returning 400 with a reason code (`UNKNOWN_PREFIX` / `MALFORMED_CURSOR`) — never an unfiltered fallback. Pagination uses limit+1 probe for `hasMore` and encodes the last returned row as `nextCursor`. Existing `events` / `count` / `catalog` envelope and `name` / `since` / `limit` defaults stay additive-compatible.
### Plan
1. Extend `SystemEventQuery` + `SystemEventDao.query` with prefix/names/actor/before SQL filters.
2. Add cursor helpers + history query params on GET /api/events/history with R3 rejection paths.
3. Preserve envelope + limit default/ceiling; project correlation fields on each row.
4. Cover DAO (R18–R20) and endpoint (R18–R21) with unit tests; measure coverage on task surfaces.
5. Same-commit design surface update (T3).
### Solution
Server-side filters and stable keyset pagination for the event history surface (task 0372 / J3 R18–R21).

| Change (`file:line`) | Why |
| --- | --- |
| `packages/domain/src/dao/system-event-dao.ts:44-83` | Extended `SystemEventQuery` with `prefix`, `names`, `actor`, and exclusive `before` keyset cursor. |
| `packages/domain/src/dao/system-event-dao.ts:196-259` | Filters assemble into SQL with `ORDER BY occurred_at DESC, id DESC` so concurrent newer inserts cannot reappear and older rows are not skipped. |
| `packages/domain/src/dao/index.ts:14` | Re-export `SystemEventQueryCursor`. |
| `apps/server/src/modules/events/index.ts:29-91` | Opaque base64url cursor encode/decode + multi-value `names` parser. |
| `apps/server/src/modules/events/index.ts:241-334` | `GET /api/events/history` accepts `prefix` / `names` / `runId` / `actor` / `cursor`; validates cataloged prefixes and opaque cursors with 400 + reason; returns additive `nextCursor` / `hasMore`. |
| `packages/domain/tests/dao/system-event-dao.test.ts:496-644` | DAO coverage: prefix, multi-name, actor, concurrent-write-stable paging, equal-timestamp id tie-break. |
| `apps/server/tests/modules/events/history.test.ts:32-385` | Endpoint coverage: filter forwarding, unknown-prefix / malformed-cursor rejection, nextCursor/hasMore, cursor helper edge cases. |
| `docs/04_DESIGN.md:1116-1129` | Same-commit surface contract for 0372 filters + keyset pagination (T3). |

**Invariants:** filters apply in SQL (R5); correlation fields still projected (R6); existing `name`/`since`/`limit` behaviour preserved (R4); uncataloged prefix / bad cursor → client error, no silent drop (R3).
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/dao/system-event-dao.ts:52-80,195-239`; `apps/server/tests/modules/events/history.test.ts:187` |
| R2 | MET | `packages/domain/src/dao/system-event-dao.ts:40-46,231-239`; `packages/domain/tests/dao/system-event-dao.test.ts:575`; `apps/server/tests/modules/events/history.test.ts:248-267` |
| R3 | MET | `apps/server/tests/modules/events/history.test.ts:209,229` |
| R4 | MET | `apps/server/src/modules/events/index.ts:319-324`; `apps/server/tests/modules/events/history.test.ts:312` |
| R5 | MET | `packages/domain/src/dao/system-event-dao.ts:195-239`; endpoint limit tests in full suite |
| R6 | MET | `apps/server/src/modules/events/index.ts:319-324`; `apps/server/tests/modules/events/history.test.ts:312,342` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R18 — History can be filtered by prefix server-side | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:496,524`; `apps/server/tests/modules/events/history.test.ts:187` |
| R19 — History can be filtered by run and by actor | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:361,544`; `apps/server/tests/modules/events/history.test.ts:187` |
| R20 — History pagination is stable under concurrent writes | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:575`; `apps/server/tests/modules/events/history.test.ts:248-267` |
| R21 — An unknown prefix or malformed cursor is rejected cleanly | MET | test | `apps/server/tests/modules/events/history.test.ts:209-245` |

**Fresh command:** `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major; actor-index and corrupt-JSON handling remain non-blocking advisories.

**Fix-pass disclosure:** `.spur/run/0372-verdict.json:1-75` regenerated; Testing now carries complete AC evidence.
### Review
**Disposition:** APPROVE · Functional PASS · SECUA no blocker/major · architecture advisory only.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | E | `packages/domain/src/migrations.ts:85-96` | `actor` filter has no index; actor-only queries scan the retention-capped ledger. Follow-up index if hot. |
| P3 | E | `apps/server/src/modules/events/index.ts:315-316` | Double `systemEventCatalogEntry` per history row — cache once. |
| P4 | C | `apps/server/src/modules/events/index.ts:317` | Pre-0372 unguarded `JSON.parse(payload_json)`; corrupt JSON 500s the page. Out of scope. |
| P4 | A | `apps/server/src/modules/events/index.ts:17-91` | Advisory: cursor helpers co-located with SSE module; extract only if file keeps growing. |
| P4 | S | `system-event-dao.ts:207-239` / `events/index.ts:268-288` | Parameterized SQL, LIKE escape, catalog/cursor 400 paths — no silent unfiltered fallback. |
| P4 | tests-pass | task surfaces | `bun test` DAO+history: 40 pass / 0 fail (2026-07-28 verify run). |

**Functional:** R1–R6 MET · AC R18–R21 MET. **Design:** DONE (keyset DAO + HTTP validation + additive envelope). **Gate:** clear approve; residual risks non-blocking.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T03:49:03.496Z todo → wip (system)
- 2026-07-29T03:54:14.763Z wip → testing (system)
- 2026-07-29T03:58:39.777Z testing → done (system)
