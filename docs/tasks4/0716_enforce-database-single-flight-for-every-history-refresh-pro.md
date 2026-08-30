---
schema_version: 1
name: "Enforce database single-flight for every history refresh producer"
status: done
template: feature-impl
created_at: 2026-08-29T23:11:49.388Z
updated_at: "2026-08-30T00:33:08.539Z"
feature_id: E31
priority: P1
tags: ["history", "reliability", "sqlite"]
---

## 0716. Enforce database single-flight for every history refresh producer

### Background

Implements feature scenarios R3 — All producers share one pending-or-processing invariant and R4 — Concurrent producers cannot bypass single-flight. The current pending-only index protects completion-trigger bursts, but schedule and Board manual producers call raw queue enqueue, while processing rows remain outside the uniqueness domain. This task owns the complete producer-to-database behavior, including the Board response status.

Rubric: E6 D1 L4 C1 R2 = 14 → decompose (force: R=high). The `--auto` pre-batch quiz was skipped. Runs before the child-process task because its active-row invariant becomes that task's execution precondition.

### Requirements

- [x] R1. Route schedule, completion, and Board manual refresh requests through one app-layer enqueue function that returns `enqueued`, `coalesced`, or `already-running`; pending payload merge keeps the earliest start/latest end, `full` dominates `incremental`, completion debounce remains intact, and immediate requests never delay an earlier due time.
- [x] R2. Replace the pending-only history-refresh index with migration 0027's pending-or-processing unique index, deterministically retire pre-existing duplicate active rows, and prove two SQLite connections cannot create or claim concurrent active refreshes; expose the closed outcome through existing events and the Board import response.

### Acceptance Criteria

```gherkin
Feature: Database single-flight history refresh

  @core
  Scenario: R1 — All producers share one pending-or-processing invariant
    Given a history refresh is pending or processing for a project
    When scheduled, operation-completion, or manual producers request another refresh
    Then no second pending refresh is created
    And no second refresh starts concurrently
    And the producer receives an observable coalesced or already-running outcome

  @core
  Scenario: R2 — Concurrent producers cannot bypass single-flight
    Given no history refresh is pending or processing
    When two independent producers enqueue at the same time
    Then the database admits exactly one pending refresh
    And both producers receive deterministic outcomes without an unhandled uniqueness error
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the existing `enqueueCoalesced`/`enqueueHistoryRefresh` path instead of adding a lock service. SQLite remains the cross-process authority through one partial unique index covering `history.refresh` rows in `pending` or `processing`; guarded insert/update logic maps conflicts to deterministic outcomes. All producers reuse that path, and the Board DTO narrows `status` to `queued | coalesced | already-running`.

Rejected: an in-memory mutex protects only one server process; retaining one pending follow-up during processing permits a second consumer to claim it concurrently; separate schema/DTO tasks would be horizontal fragments below the two-hour floor.

Invariants: at most one active history refresh row per project; other queue job types retain multiplicity; migration preserves an auditable terminal record for retired duplicates; enqueue uniqueness errors never escape as producer failures.

### Plan

1. Add the 0027 migration and active-row race/migration tests.
2. Extend the existing coalescing writer with processing detection and deterministic due-time/payload merge semantics.
3. Route completion, schedule, and Board manual producers through the shared writer.
4. Narrow the Board response status and update producer/event tests plus the accepted design docs if as-built shapes differ.
5. Run targeted domain/app/server/contracts/web tests, then workspace gates.

### Solution
Single-flight for every history refresh producer is now enforced in the database (pending-or-processing unique index), routed through one coalescing writer, and surfaced as `queued | coalesced | already-running` end to end.

- Plan step 1 (migration 0027 — active unique index):
  - packages/domain/src/migrations.ts:76 — base schema gains partial unique index `queue_jobs_history_refresh_active_unique` on `type` WHERE `type='history.refresh' AND status IN ('pending','processing')`
  - packages/domain/src/migrations.ts:675-692 — `HISTORY_REFRESH_ACTIVE_UNIQUE_SCHEMA_SQL`: retires duplicate active rows to `status='failed'` with audit `last_error` and `processing_at=NULL`, keeps the oldest survivor (`created_at ASC, id ASC`), drops the old pending-only index, creates the active unique index
  - packages/domain/src/migrations.ts:789-790 — `CLI_MIGRATIONS` entry `0027_spur_cli_history_refresh_active_unique`
  - packages/domain/src/migrations.ts:916-929 — runner skip guard: journals 0027 but skips when `queue_jobs` does not exist yet (fresh databases get the index from the base schema)
  - drizzle/0027_spur_cli_history_refresh_active_unique.sql — drizzle mirror of migration 0027 (whole file)
- Plan step 2 (coalescing writer):
  - packages/domain/src/db.ts:191-195 — `CoalescedEnqueueSpec.immediate?: boolean`
  - packages/domain/src/db.ts:202-206 — `CoalescedEnqueueResult` gains `{ status: 'already-running'; jobId; payload }`
  - packages/domain/src/db.ts:236-324 — `enqueueCoalesced`: processing detection, deterministic merge, bounded 3-pass retry loop; exhaustion throws loudly instead of returning a fake outcome
  - packages/domain/src/db.ts:239,291 — due-time semantics: fresh immediate job due now; an immediate join only SHORTENS due time (`min(existing, now)`), never delays an earlier due time; non-immediate joins slide to `now + debounceMs`
  - packages/domain/src/db.ts:309,320 — processing row found (either pre-scan or claimed between read and update) → `already-running` with that job's id/payload
- Plan step 3 (producers routed through the shared writer):
  - packages/app/src/services/history-refresh-service.ts:37-56 — `HistoryRefreshPayload.importMode?`, result union, `HistoryRefreshEnqueueOptions` (`triggerId?`, `importMode?`)
  - packages/app/src/services/history-refresh-service.ts:95-150 — `enqueueHistoryRefresh`: manual ungated, schedule gated on `scheduleMinutes`, completion gated on `onCompletion`; manual/schedule are immediate; merge keeps earliest start/latest end with `full` dominating `incremental` (132-135); returns the post-merge payload
  - apps/server/src/serve.ts:172-181 — scheduler entry enqueues via the writer (no raw job insert); call at 176-178
  - apps/server/src/context.ts:420-446 — `triggerImport` rides the writer (426-431); `disabled` throws; enqueued→`queued`, coalesced→`coalesced`, already-running→`already-running` with per-outcome messages (434-445)
- Plan step 4 (Board DTO + events):
  - packages/contracts/src/history.ts:462 — Board response status narrowed to `z.enum(['queued', 'coalesced', 'already-running'])`
  - packages/app/src/services/history-board-mock-service.ts:974 — mock receipt status `queued`
  - packages/app/src/services/event-names.ts:917 — `history.refresh.enqueued` ledger schema exposes `outcome` field
  - apps/cli/src/history-refresh.ts:48 — CLI emit carries `outcome: result.status` (legacy `coalesced` boolean kept)
- Plan step 5 (tests):
  - packages/domain/tests/db.test.ts:309-405 — writer already-running outcomes incl. claimed-between-read-and-update race (R4)
  - packages/domain/tests/db.test.ts:452-485 — processing row on a SECOND SQLite connection yields already-running, no duplicate
  - packages/domain/tests/db.test.ts:500-548 — immediate join shortens due time, never extends it; immediate fresh enqueue due now (R2)
  - packages/domain/tests/db.test.ts:559-640 — migration 0027 journal-rewind: duplicate retirement, index swap, active index actually enforces single-flight; foundation-only skip covered
  - packages/app/tests/services/history-refresh-service.test.ts:116-230 — producer suite: manual ungated/immediate, schedule gating, already-running passthrough, full-dominates merge with due pulled in
  - packages/app/tests/services/history-board-service.test.ts:309-331 — Board receipt status asserted as `queued`
  - packages/app/tests/services/history-board-mock-service.test.ts:172 — mock service `queued`
  - packages/contracts/tests/history-contract.test.ts:481-497 — fixture uses `queued`; synchronous `completed` status now rejected by the schema
  - apps/server/tests/serve.test.ts:643-674 — scheduler test against a real migrated in-memory DB; asserts the queue_jobs row
  - apps/server/tests/context.test.ts:283-310 — Board trigger joins a pending refresh (`coalesced`) and reports an in-flight one (`already-running`, runId preserved)
  - apps/cli/tests/history-refresh.test.ts:43-65 — ledger row payload asserts `data.outcome: 'enqueued'`, `coalesced: false`, `jobId` matches the queue row
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Single app-layer fn `enqueueHistoryRefresh` (packages/app/src/services/history-refresh-service.ts:95-150) returning enqueued/coalesced/already-running (:41-45); all three producers routed through it: schedule apps/server/src/serve.ts:170-181, Board manual apps/server/src/context.ts:420-446, completion CLI apps/cli/src/history-refresh.ts:34. Merge keeps earliest start/latest end with full dominating incremental (history-refresh-service.ts:129-143). Immediate never delays an earlier due: packages/domain/src/db.ts:239,291 (join due = min(existing, now)); completion debounce intact (debounced joins slide window, db.ts:239 non-immediate due = now+debounceMs). Tests: packages/domain/tests/db.test.ts:500-538 (immediate join shortens due, later immediate never extends), db.test.ts:540-556 (fresh immediate due now), db.test.ts:228-262 (debounced burst coalesces, window spans all), packages/app/tests/services/history-refresh-service.test.ts:84 (burst of 5 coalesces to one job), :117 (manual ungated + immediate), :137 (schedule gated on schedule_minutes), :182 (full dominates, never delays earlier due). |
| R2 | MET | Migration 0027 pending-or-processing unique index: packages/domain/src/migrations.ts:76 (base schema index for fresh DBs), migrations.ts:675-693 (retire duplicate active rows to terminal failed with audit last_error keeping oldest created_at ASC id ASC, drop pending-only index, create active index), migrations.ts:783-791 (CLI_MIGRATIONS entry), migrations.ts:911-929 (skip guard journals without executing when queue_jobs absent), drizzle/0027_spur_cli_history_refresh_active_unique.sql (mirror). Two SQLite connections cannot create a concurrent active refresh: packages/domain/tests/db.test.ts:264-307 (two connections on one file DB, concurrent Promise.all enqueues admit exactly one pending row, outcomes {enqueued, coalesced}, same jobId); index-level enforcement db.test.ts:599-604 (duplicate active INSERT rejects). Cannot claim concurrent active: db.test.ts:452-498 (processing row on connection A; two concurrent producers on connection B both get already-running with the in-flight jobId, exactly 1 row), db.test.ts:364-412 (claimed-between-read-and-update race resolves already-running), db.test.ts:309-336 (processing is single-flight). No unhandled uniqueness error: writer db.ts:236-327 (INSERT ON CONFLICT DO NOTHING + guarded UPDATE WHERE status=pending RETURNING + bounded 3-pass retry; exhaustion is a loud throw db.ts:322-325, never a silent drop) with db.test.ts:414-427. Closed outcome through existing events: apps/cli/src/history-refresh.ts:41-52 (ledger emit carries outcome), packages/app/src/services/event-names.ts:909-935 (presenter exposes outcome), docs/design/event-tracking.md:298 (canonical matrix row). Board import response narrowed to queued |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — All producers share one pending-or-processing invariant | MET | test | Pending-or-processing invariant: partial unique index migrations.ts:76,692 covers status IN (pending, processing); writer returns already-running for in-flight (db.ts:305-310). No second pending row created for scheduled, completion, or manual producers: packages/app/tests/services/history-refresh-service.test.ts:158 (in-flight import reports already-running instead of stacking a second job), :137, :117, :84, :63; db.test.ts:309-336, 364-412, 452-498 (rows.length = 1 assertions). No second refresh starts concurrently: consumer claims the single row, others get already-running (db.test.ts:452-498 asserts 1 processing row remains). Observable coalesced/already-running outcome: result union history-refresh-service.ts:41-45; Board status/message context.ts:436-444 (apps/server/tests/context.test.ts:283-310: trigger joins pending -> coalesced, in-flight -> already-running with runId preserved); CLI ledger emit apps/cli/tests/history-refresh.test.ts:43-65 (asserts data.outcome, coalesced, jobId). |
| R2 — Concurrent producers cannot bypass single-flight | MET | test | Two independent connections on one SQLite file enqueue concurrently: packages/domain/tests/db.test.ts:264-307 — exactly one pending refresh admitted (rows.length = 1), deterministic outcomes {enqueued, coalesced}, both producers get the same jobId, merged payload spans both; no uniqueness error escapes (writer handles conflict, db.ts:246-260,301). Claim race also deterministic: db.test.ts:364-412 (claimed-between-read-and-update -> already-running, 1 row). Index itself rejects duplicate active rows: db.test.ts:599-604 (second active INSERT rejects). Foundation-only DBs: db.test.ts:610-626 (0027 journaled and skipped, applied=1). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | behavior-change | packages/domain/src/db.ts:250 | Schedule producer silently lost `maxRetries: 1`: the old `serve.ts` path enqueued with `{ maxRetries: 1 }`; the unified writer hardcodes `max_retries 3`. Bounded retry bump is defensible for idempotent refresh jobs but undocumented in the task Solution. |
| P4 | docs | docs/04_DESIGN.md:1112-1114 | Event description drift (still `trigger/jobId/windowStart/windowEnd`; missing `triggerId`/`coalesced`/`outcome`). Predates 0716 (0549 added `coalesced` without updating it); canonical matrix at `docs/design/event-tracking.md:298` is correct. |
**Verdict: approve.** No requirement/AC gaps found. Two P4 observations (non-blocking) below.

Reviewed the full working-tree diff (20 files, +657 −145, plus untracked `drizzle/0027_spur_cli_history_refresh_active_unique.sql`) against R1 (single app-layer enqueue fn), R2 (migration + deterministic outcomes), R3/R4 (pending-or-processing invariant across concurrent producers).

**Correctness (race semantics) — sound.**
- `packages/domain/src/db.ts:236-327` `enqueueCoalesced`: atomic `INSERT … ON CONFLICT DO NOTHING` (db.ts:246-260) against the active partial index; conflict → pending select → guarded `UPDATE … WHERE status='pending' RETURNING` (db.ts:292-300); processing select → `already-running` with in-flight id (db.ts:307-310). Bounded 3-pass loop covers claim-between-read-and-update; exhaustion is loud (`enqueueCoalesced: … stayed active past 3 attempts`, db.ts:322-325) — never a silent drop, never a fake outcome.
- `immediate` semantics: fresh due = now (db.ts:239); join due = `min(pending.next_retry_at ?? now, now)` (db.ts:291) — immediate never delays an earlier due; debounced joins slide the window (completion debounce intact, R1).
- No-target `ON CONFLICT DO NOTHING` is safe: only the scoped partial index can conflict for this type; other job types unaffected.

**Data/migration safety — sound.**
- `packages/domain/src/migrations.ts:664-692` (0027): deterministic retirement keeps oldest active survivor (`created_at ASC, id ASC`), others → auditable terminal `failed` with `last_error`, `processing_at=NULL`; retirement UPDATE precedes DROP old/CREATE new index (correct order); idempotent re-run.
- Base schema creates the active index for fresh DBs (`migrations.ts:76`); 0027 skip-guard journals-without-executing when `queue_jobs` is absent (foundation-only DBs, `migrations.ts:907-929`) — and `queue_jobs` has exactly one creation surface (`QUEUE_JOBS_SCHEMA_SQL`), so no path can create the table without the active index.
- Drizzle mirror `drizzle/0027_spur_cli_history_refresh_active_unique.sql` matches CLI SQL exactly; sequence follows 0026.

**API/contract surface — sound.**
- `enqueueHistoryRefresh` (`packages/app/src/services/history-refresh-service.ts:95-150`): gating before any DB access (:100-106), `immediate` for manual/schedule (:111), merge keeps first producer's trigger identity + min/max window + `full` dominates `incremental` (:129-143).
- Board `triggerImport` (`apps/server/src/context.ts:420-446`): disabled → loud throw; outcomes map to `queued`|`coalesced`|`already-running` with per-outcome messages; `runId` = in-flight job id for already-running. Contract narrowed at `packages/contracts/src/history.ts:462`. CLI emit always a real outcome (`disabled` short-circuits before emit, `apps/cli/src/history-refresh.ts:35-52`). Event payload honest; ledger presenter updated (`packages/app/src/services/event-names.ts:910-930`); canonical matrix `docs/design/event-tracking.md:298` updated. Web safe: `SourcesTab.tsx:16,101-105` renders status as an opaque string.

**Tests — present and passing.** Two-connection race proofs (`packages/domain/tests/db.test.ts`: cross-connection pending race, processing-on-another-connection, claimed-between-read-and-update, immediate never-extend), migration 0027 rewind test with index-swap + enforcement assertions (db.test.ts:559-604), foundation-only journal+skip test; producer outcome suite, Board DTO narrowing, contract rejection of `'completed'`, scheduler against real migrated DB. Targeted run: **184 tests pass, 0 fail** (domain db+migrations 75, app service+contracts 27, server+cli 82).

**Findings (non-blocking):**
- **P4** — Schedule producer silently lost `maxRetries: 1`: old `serve.ts` path used `queue.enqueue(HISTORY_REFRESH_JOB, payload, { maxRetries: 1 })`; the unified writer hardcodes `max_retries 3` (db.ts:250). Bounded retry bump is defensible for idempotent refresh jobs, but it is an undocumented behavior change (not in the task Solution).
- **P4** — `docs/04_DESIGN.md:1112-1114` event description drift (still `trigger/jobId/windowStart/windowEnd`; missing `triggerId`/`coalesced`/`outcome`). Predates this task (0549 added `coalesced` without updating it); canonical matrix in `docs/design/event-tracking.md` is correct.

**Observation (correct per spec):** a later debounced completion join can push due time out beyond an immediate join's shortened due — R1 binds only immediate requests not to delay an earlier due; completion debounce intact is exactly this behavior.

**Requirement/AC gaps: none.** Nothing committed; no suppressions introduced.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-30T00:10:07.730Z todo → wip (system)
- 2026-08-30T00:33:08.196Z wip → testing (system)
- 2026-08-30T00:33:08.539Z testing → done (system)
