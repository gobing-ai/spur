---
schema_version: 1
name: Aggregate daily project event counts in the ledger
status: done
template: issue
created_at: 2026-11-19T22:19:32.573Z
updated_at: "2026-11-20T03:21:03.817Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1408. Aggregate daily project event counts in the ledger

### Background

`spur history summary --all-projects` (task 1402) shows, for every running registered project, today's event counts grouped by prefix and the five latest events. `readProject` (`packages/app/src/services/projects-summary.ts:95-151`) produces both by paging the whole day through `GET /api/events/history?since=<day start>&limit=50`, following `nextCursor` until it runs out, and counting prefixes on the client. On a busy project this costs O(events/50) round trips. Each page also re-sends the full `catalog` metadata (`apps/server/src/modules/events/index.ts:432-438`), and every page shares one 3 s budget (`AbortSignal.timeout`). As a result, an active project can be reported `unreachable` even though it is healthy.

Goal: the server counts the retained day events per prefix in SQL (the ledger), and the client fetches only the five newest payloads, so a modern server answers in one request. Older project servers that lack the aggregate must still produce the same report through the existing paging path.

**Refine corrections (2026-11-19)**
- The task had only a title-derived stub. This refine adds Background, Root Cause, Design, Plan and ACs from a tree audit.
- "Retained" is precise: `system_events` is pruned per prefix (`SystemEventDao.pruneQuotas`, `packages/domain/src/dao/system-event-dao.ts:352`). Counts cover retained rows, the same as today's paging result.
- Prefix semantics were checked. The catalog prefix is the first `.`-segment of the event name (`packages/app/src/services/event-names.ts:2077`), and the server's fallback is `event_name.split('.')[0]`. SQL `substr(event_name, 1, instr(event_name,'.')-1)` (already used at `system-event-dao.ts:919`) is therefore equivalent.
- No issue was dropped. R1 → R1–R2 and R2 → R3–R4 were made concrete.

### Requirements

- [x] R1. The ledger counts events per prefix in SQL. A new `SystemEventDao.countByPrefix({ since })` returns `Array<{ prefix, count }>` for `occurred_at >= since`, computed with one `GROUP BY` over the first `.`-segment of `event_name`.
- [x] R2. `GET /api/events/history` accepts an opt-in `counts=prefix` query param. When it is present, the response adds `prefixCounts: Array<{prefix, count}>` for the same `since` window. Only `since` scopes it; the other filters do not apply. All existing fields and behaviour stay unchanged, and requests without the param produce byte-identical responses.
- [x] R3. `readProject` asks for `since=<day start>&limit=5&counts=prefix` in a single request. When `prefixCounts` is an array, it uses those counts and the five returned events as `latest`, and makes no further history requests.
- [x] R4. Compatibility and report states are preserved.
    - If the response lacks `prefixCounts` (an older project server ignores the unknown param), `readProject` falls back to the existing cursor paging and gets identical `eventCounts`/`latest`. The fallback re-requests with `limit=50` and does not re-count the first response.
    - `ok`, `unreachable`, `stopped`, `gateway-down` and `remote-not-proxied` keep their current meaning and messages.
    - `eventCounts` stays sorted by count descending, and an empty day keeps `eventCounts: []`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — DAO counts retained events per prefix in SQL (req: R1)
  Given an in-memory DB with events `task.created`×3, `message.sent`×2 and one `task.done` older than `since`
  When `countByPrefix({ since })` runs
  Then it returns `[{prefix:'task',count:3},{prefix:'message',count:2}]` (in any order) from one query

Scenario: AC2 — history route serves prefixCounts only on opt-in (req: R2)
  Given the events module over a seeded ledger
  When `GET /api/events/history?since=S&limit=5&counts=prefix` is requested
  Then the body has `events.length <= 5`, newest first, and `prefixCounts` equal to the DAO result
  And the same request without `counts` has no `prefixCounts` key and an otherwise unchanged shape

Scenario: AC3 — modern server: one history request (req: R3)
  Given `collectProjectsView` over the real gateway handler with a project holding 120 events today
  When the view is collected
  Then the project row is `ok` with correct `eventCounts` and five `latest`
  And the fetch seam recorded exactly one `/api/events/history` request, which carries `counts=prefix` and `limit=5`

Scenario: AC4 — older server: paging fallback gives the same report (req: R4)
  Given a fetch stub that ignores `counts` and pages 120 events in 50-row pages with `nextCursor`
  When the view is collected
  Then `eventCounts` and `latest` equal those from AC3, and the state is `ok`
  And a stub returning a 500 or a repeated cursor still yields `unreachable` with the current messages
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen approach: an additive opt-in aggregate on the existing route, plus client feature detection.**

1. **Domain:** `SystemEventDao.countByPrefix(spec: { since: string }): Promise<Array<{ prefix: string; count: number }>>` in `packages/domain/src/dao/system-event-dao.ts`. Reuse the prefix expression already used at `:919`:
   ```sql
   SELECT CASE WHEN instr(event_name,'.')>0 THEN substr(event_name,1,instr(event_name,'.')-1) ELSE event_name END AS prefix,
          COUNT(*) AS count
   FROM system_events WHERE occurred_at >= ?1 GROUP BY prefix
   ```
   It does no payload `json_extract`, so it stays cheap. Follow the error convention of the neighbouring methods.
2. **Server:** in the `/api/events/history` handler (`apps/server/src/modules/events/index.ts:344`):
   - Read `counts`. When it equals `'prefix'`, run `dao.countByPrefix({ since: sinceParam ?? '' })` in parallel with the page query, and add `prefixCounts` to the JSON.
   - Any other value of `counts` is ignored, matching how the route treats unknown params today.
   - No other field changes (the route's existing R4 comment: "additive only").
   - The route is a hand-written Hono route, not an oRPC contract, so `packages/contracts` does not change. Update the web wire type `SystemEventsTab.tsx:90` only if typecheck requires it (the field is optional).
3. **Client:** in `readProject` (`packages/app/src/services/projects-summary.ts:113-147`):
   - First request: `since`, `limit=5`, `counts=prefix`.
   - If `Array.isArray(body.prefixCounts)`, take counts from it (sorted by count, descending), take `latest = body.events.slice(0,5).map(toSummary)`, and return `ok`.
   - Otherwise run the **existing** paging loop unchanged, starting a fresh request with `limit=50` and no `counts`.
   - Keep the shared `AbortSignal.timeout(timeoutMs)` across both paths.
   - Ignore malformed `prefixCounts` entries (non-string prefix or non-finite count) rather than failing the row.
4. **Docs:** update `docs/design/history-cli-contracts.md:629` (the `--all-projects` read contract) and the `/api/events/history` row in `docs/design/observability-contracts.md:341` to describe `counts=prefix`/`prefixCounts` (T3).

**Rejected alternatives**
- A new `/api/events/counts` route: needs 404-based detection and two requests, and adds a new surface.
- Reusing `eventSummary`: payload JSON extraction plus buckets is far heavier than a count.
- Raising `limit` to 500: still unbounded paging, and it ships 500 payloads.

**Ceiling (accepted):** `occurred_at >= since` with no index-only plan scans the day's retained rows once. That is bounded by the retention quotas and far cheaper than N HTTP pages. Add an index only if profiling shows a need.

### Plan

1. **Tests first** (watch them fail):
   - `packages/domain/tests/dao/system-event-dao.test.ts` → AC1. Use in-memory SQLite.
   - `apps/server/tests/modules/events/history.test.ts` → AC2.
   - `packages/app/tests/services/projects-summary.test.ts` → AC3 (count `/api/events/history` calls through the fetch seam) and AC4 (a legacy stub that ignores `counts`, plus the 500 and repeated-cursor cases).
2. Implement `SystemEventDao.countByPrefix`.
3. Add the `counts=prefix` branch to the history route.
4. Add the single-request path to `readProject`, with the unchanged paging fallback.
5. Update `docs/design/history-cli-contracts.md` (§ `--all-projects`) and `docs/design/observability-contracts.md` (history row).
6. Run the focused tests in each workspace: `(cd packages/domain && bun test <dao test>)`, `(cd apps/server && bun test tests/modules/events/history.test.ts)`, `(cd packages/app && bun test tests/services/projects-summary.test.ts)`. Then run `bun run spur-check`.
7. Commit per task: `perf(history): aggregate daily project event counts in the ledger (1408)`.

### Root Cause

Verified 2026-11-19 against HEAD `3c39f9a2e`:

- The client computes the counts by full pagination: `packages/app/src/services/projects-summary.ts:114-141`. It uses `limit=50` and a `do … while (cursor !== null)` loop that counts every event and keeps the first five as `latest`.
- The server exposes no per-prefix count for a time window on the history route: `apps/server/src/modules/events/index.ts:344-439` returns `events`, `count` (page size only), `catalog`, `nextCursor` and `hasMore`. The only per-prefix aggregate is `SystemEventDao.eventSummary`, which is bucketed and computes severity, top types and errors through `json_extract` over the payload (`packages/domain/src/dao/system-event-dao.ts:890-960`). It is too heavy for a count and lives behind the observability route (`apps/server/src/modules/observability/index.ts:366`).
- So the work scales with the day's event volume rather than with the number of prefixes, and all pages share one 3 s timeout.

### Solution

The ledger groups retained event names by first segment over the inclusive day window. Opt-in history requests return these counts beside the bounded recent page. The report uses that page on upgraded projects and resumes the original cursor pagination when the response lacks aggregate data.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The real SQLite test in `packages/domain/tests/dao/system-event-dao.test.ts` verifies prefix counts including the boundary and a malformed payload. |
| R2 | MET | `apps/server/tests/modules/events/history.test.ts` checks opt-in totals against the same unmodified ordinary page on a real ledger. |
| R3 | MET | `packages/app/tests/services/projects-summary.test.ts` asserts one limit=5 request carrying counts=prefix for 120 events. |
| R4 | MET | The same gateway integration exercises old paging with matching report output, HTTP 500, repeated cursor, and retained stopped, remote and timeout states. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts` |
| AC2 | MET | test | `apps/server/tests/modules/events/history.test.ts` |
| AC3 | MET | test | `packages/app/tests/services/projects-summary.test.ts`, upgraded server |
| AC4 | MET | test | `packages/app/tests/services/projects-summary.test.ts`, report parity and failure cases |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P4 (advisory) | The opt-in field counts the whole requested day independently of the page filters. Older servers retain the original report pagination and error handling. | `apps/server/src/modules/events/index.ts`, `packages/app/src/services/projects-summary.ts` | ACCEPTED |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-20T03:20:47.992Z todo → wip (system)
- 2026-11-20T03:20:50.303Z wip → testing (system)
- 2026-11-20T03:21:03.683Z testing → done (system)

