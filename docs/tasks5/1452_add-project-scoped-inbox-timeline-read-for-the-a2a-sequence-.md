---
schema_version: 1
name: Add project-scoped inbox.timeline read for the A2A sequence view
status: todo
template: feature-impl
created_at: 2026-11-25T23:54:35.752Z
updated_at: "2026-11-26T00:02:55.266Z"
feature_id: A821
priority: P2

estimate_hours: 5
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

- [ ] R1. `inbox.timeline` oRPC procedure in `packages/contracts/src/inbox.ts` (`GET /inbox/timeline`) with optional `members[]`, `direction` (in|out|both relative to members), `kind`, `status`, `threadId`, `since`, `until`, `limit` (default 200, max 500) and opaque keyset `cursor`.
- [ ] R2. `InboxService.timeline` returns rows oldest-first by `(createdAt, id)` across all addresses, reusing `encodeCursor`/`decodeCursor`; filters are pushed into one new `InboxDao.timeline` query.
- [ ] R3. Rows reuse the message projection with `body` truncated to an excerpt (`TIMELINE_EXCERPT_CHARS = 280`); the read is side-effect free (no sweep, no claim, no event prune).
- [ ] R4. Server handler maps a malformed cursor to BAD_REQUEST like `list`; `inbox.list` input and output are unchanged.
- [ ] R5. `docs/design/inter-agent-control-plane.md` §13 surface table names `inbox.timeline`; the runtime-generated OpenAPI spec exposes `/inbox/timeline` (asserted in `apps/server/tests/openapi.test.ts`).

Out of scope: cross-project stitching (feature T), any write path, Board UI (1454).

### Acceptance Criteria

- [ ] AC1 — Project-scoped inbox read serves the sequence view (req: R1, R2, R3, R4, R5)
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
