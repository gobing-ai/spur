---
schema_version: 1
name: Add project-scoped inbox.timeline read for the A2A sequence view
status: done
template: feature-impl
created_at: 2026-11-25T23:54:35.752Z
updated_at: "2026-11-26T03:10:26.852Z"
feature_id: A821
priority: P2

estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1452. Add project-scoped inbox.timeline read for the A2A sequence view

### Background

Implements: R2 — Project-scoped inbox read serves the sequence view

`inbox.list` requires one `member` (`packages/contracts/src/inbox.ts`), so no read spans the project. Design: `docs/design/integrations-module.md` §3.1.

Rubric: E6 D1 L4 C0 R1 = 12 → own task (contract + service + DAO + handler rollback boundary).


**Refine corrections (2026-11-25)**
- "the OpenAPI baseline is regenerated" (R5) → OpenAPI is generated at runtime by `generateOpenApiSpec` (`apps/server/src/openapi.ts:13`); no baseline file is tracked → R5 now asserts `/inbox/timeline` in `apps/server/tests/openapi.test.ts`.
- AC1 lacked `(req:)` linkage and a test layer → added req linkage and DAO/service/handler/spec test files.
- Design lacked frozen names, cursor algorithm, anti-patterns and handoff → frozen in Design (DAO query shape verified against `packages/domain/src/dao/inbox-dao.ts:450-469`).
- Estimate unset → 5 h.

### Requirements

- [x] R1. `inbox.timeline` oRPC procedure in `packages/contracts/src/inbox.ts` (`GET /inbox/timeline`) with optional `members[]`, `direction` (in|out|both relative to members), `kind`, `status`, `threadId`, `since`, `until`, `limit` (default 200, max 500) and opaque keyset `cursor`.
- [x] R2. `InboxService.timeline` returns rows oldest-first by `(createdAt, id)` across all addresses, reusing `encodeCursor`/`decodeCursor`; filters are pushed into one new `InboxDao.timeline` query.
- [x] R3. Rows reuse the message projection with `body` truncated to an excerpt (`TIMELINE_EXCERPT_CHARS = 280`); the read is side-effect free (no sweep, no claim, no event prune).
- [x] R4. Server handler maps a malformed cursor to BAD_REQUEST like `list`; `inbox.list` input and output are unchanged.
- [x] R5. `docs/design/inter-agent-control-plane.md` §13 surface table names `inbox.timeline`; the runtime-generated OpenAPI spec exposes `/inbox/timeline` (asserted in `apps/server/tests/openapi.test.ts`).

Out of scope: cross-project stitching (feature T), any write path, Board UI (1454).

### Acceptance Criteria

- [x] AC1 — Project-scoped inbox read serves the sequence view (req: R1, R2, R3, R4, R5)
  - Given inbox rows across several addresses, When `inbox.timeline` is called with member/kind/status/time filters and paged by `nextCursor`, Then rows return oldest-first with no gaps or duplicates, bodies are excerpts, a bad cursor is BAD_REQUEST and `inbox.list` is unchanged.
  - Test layers: DAO `packages/domain/tests/dao/inbox-dao.test.ts` (in-memory SQLite, ordering/filters/cursor); service `packages/app/tests/services/inbox-service.test.ts` (excerpt, no side effects); handler `apps/server/tests/modules/inbox/handlers.test.ts` (BAD_REQUEST); spec `apps/server/tests/openapi.test.ts` (path present).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT/WHY.** The A2A sequence view (1454) needs every member's traffic in time order; `inbox.list` (`packages/contracts/src/inbox.ts:151`) is per-address and newest-first (`packages/domain/src/dao/inbox-dao.ts:450-469`), so an additive read is required.

**Frozen names.**
- Contract: `inboxTimelineInputSchema`, `inboxTimelineResponseSchema` (`{ messages: InboxMessage[]; nextCursor: string | null }`), procedure `timeline`, route `GET /inbox/timeline`, tag `inbox`.
- Service: `InboxService.timeline(filter: InboxTimelineFilter, page?: { limit?: number; cursor?: string })` in `packages/app/src/services/inbox-service.ts`.
- DAO: `InboxDao.timeline(filter, limit, after?: { createdAt: number; id: string })` in `packages/domain/src/dao/inbox-dao.ts`.
- Constant: `TIMELINE_EXCERPT_CHARS = 280` (service-level; truncation in the service, not SQL, so the DAO row type stays `InboxMessage`).

**Algorithm.** `ORDER BY created_at ASC, id ASC`, cursor predicate `created_at > ?c OR (created_at = ?c AND id > ?i)`, fetch `limit + 1` to derive `nextCursor` (same shape as `list`, inverted). `members` with `direction`: `in` → `to_id IN (…)`, `out` → `from_id IN (…)`, `both` → either; absent `members` ignores `direction`. `since`/`until` bound `created_at` inclusively. All parameters bound, never interpolated.

**Anti-patterns.** Do not change `inbox.list` or reuse its DESC query with a client-side reverse; do not call `sweep`/`pruneEvents`; do not return full bodies; do not add a new cursor codec.

**Handoff.** 1454 consumes `inbox.timeline` through the typed oRPC client; it relies on oldest-first order and `nextCursor` for "load more". OpenAPI is generated at runtime (`apps/server/src/openapi.ts:13`); there is no committed baseline to regenerate.

### Plan

1. Failing tests first: DAO ordering/filter/cursor cases, service excerpt + no-side-effect case, handler BAD_REQUEST case, OpenAPI path assertion (R1–R5).
2. Contract schemas + procedure (R1).
3. `InboxDao.timeline` (R2).
4. `InboxService.timeline` with excerpt and cursor reuse (R2, R3).
5. Server handler via `implement(contract)` (R4).
6. §13 surface row in `docs/design/inter-agent-control-plane.md` (R5).
7. Verify: `(cd packages/domain && bun test tests/dao/inbox-dao.test.ts)`, `(cd packages/app && bun test tests/services/inbox-service.test.ts)`, `(cd apps/server && bun test tests/modules/inbox tests/openapi.test.ts)`, then `bun run spur-check`.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `packages/contracts/src/inbox.ts` | 97-121 | `inboxTimelineInputSchema` + `inboxTimelineResponseSchema`: the filter vocabulary (`members[]`, `direction` relative to members, `kind`, `status`, `threadId`, inclusive `since`/`until`, `limit` ≤ 500, opaque cursor) and the `{messages, nextCursor}` page, so the Board's sequence view has a typed read rather than N per-member pages. |
| `packages/contracts/src/inbox.ts` | 197-205 | `timeline` procedure at `GET /inbox/timeline`, tag `inbox`; `list` and its response are untouched (R4). |
| `packages/domain/src/dao/inbox-dao.ts` | 57-69 | `InboxTimelineFilter` — absent filters narrow nothing; `direction` is meaningless without `members`, which is what lets one query serve project-wide and per-agent reads. |
| `packages/domain/src/dao/inbox-dao.ts` | 491-553 | `InboxDao.timeline`: one `ORDER BY created_at ASC, id ASC` query with a forward keyset predicate (`created_at > ?c OR (created_at = ?c AND id > ?i)`), every filter a bound parameter, `limit + 1` read to detect a next page. |
| `packages/domain/src/dao/index.ts` | 55 | Re-export the new filter type so `packages/app` can name it. |
| `packages/app/src/services/inbox-service.ts` | 155-163 | `TIMELINE_EXCERPT_CHARS = 280` + `excerpt()`: the page carries a marked excerpt, the full body stays in `thread` (R3). |
| `packages/app/src/services/inbox-service.ts` | 402-422 | `InboxService.timeline(filter, page?)`: reuses `encodeCursor`/`decodeCursor`, defaults `limit` to 200, truncates bodies, derives `nextCursor`. No sweep, no claim, no prune — the read is side-effect free. |
| `apps/server/src/modules/inbox/handlers.ts` | 185-208 | `timeline` handler: forwards only the fields given, maps a malformed cursor to `BAD_REQUEST` exactly as `list` does (R4). |
| `docs/design/inter-agent-control-plane.md` | 335 | §13 surface table names `inbox.timeline` and its excerpt rule (R5). |
| `packages/domain/tests/dao/inbox-dao.test.ts` | 324-399 | Ordering, forward paging (no gaps/repeats), and every filter incl. empty `members` narrowing nothing (R2). |
| `packages/app/tests/services/inbox-service.test.ts` | 411-462 | Page + excerpt, filters, side-effect freedom, malformed cursor (R2, R3). |
| `apps/server/tests/modules/inbox/handlers.test.ts` | 701-734 | Handler page, unchanged table counts, member narrowing, `BAD_REQUEST` cursor (R4). |
| `apps/server/tests/openapi.test.ts` | 55-66 | The runtime-generated spec exposes `/inbox/timeline` with its query parameters (R5). |

**Design notes.** The cursor is the SAME codec as `list` (`{c,i}` base64url), so a client cannot hold two cursor shapes; only the comparator is inverted because this read is oldest-first. `members: []` is treated as absent (narrow nothing) rather than "match none", because the A2A sequence view sends the filter object unconditionally. `both` binds the member list twice in SQL, so the values are bound twice — deliberate, not a duplicate-binding bug.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/inbox.ts` timeline route GET /inbox/timeline with members/direction/kind/status/threadId/since/until/limit(max 500)/cursor; `apps/server/tests/modules/inbox/handlers.test.ts:701` |
| R2 | MET | `packages/domain/src/dao/inbox-dao.ts` InboxDao.timeline ORDER BY created_at ASC, id ASC with forward keyset; `packages/domain/tests/dao/inbox-dao.test.ts:324`; `packages/app/tests/services/inbox-service.test.ts:412` |
| R3 | MET | `packages/app/src/services/inbox-service.ts` TIMELINE_EXCERPT_CHARS=280 excerpt, no sweep/claim/prune; `apps/server/tests/modules/inbox/handlers.test.ts:702` leaves both tables unchanged |
| R4 | MET | `apps/server/src/modules/inbox/handlers.ts` toOrpcError(error,'BAD_REQUEST'); `apps/server/tests/modules/inbox/handlers.test.ts:724`; list cursor test unchanged `apps/server/tests/modules/inbox/handlers.test.ts:364` |
| R5 | MET | `docs/design/inter-agent-control-plane.md:335` §13 row names timeline; `apps/server/tests/openapi.test.ts:55` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Project-scoped inbox read serves the sequence view | MET | test | `apps/server/tests/modules/inbox/handlers.test.ts:701`; `packages/app/tests/services/inbox-service.test.ts:411`; `apps/server/tests/openapi.test.ts:55` (domain 22, app 30, contracts 65, server 36 pass this run) |
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

- 2026-11-26T00:18:08.258Z todo → wip (system)
- 2026-11-26T00:18:55.336Z wip → testing (system)
- 2026-11-26T00:18:57.374Z testing → done (system)

