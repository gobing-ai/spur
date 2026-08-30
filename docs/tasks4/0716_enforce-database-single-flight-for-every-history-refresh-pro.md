---
schema_version: 1
name: "Enforce database single-flight for every history refresh producer"
status: done
template: feature-impl
created_at: 2026-08-29T23:11:49.388Z
updated_at: "2026-08-30T04:24:34.751Z"
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
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:157-211` routes every producer through one result-bearing writer; `packages/app/tests/services/history-refresh-service.test.ts:157-249` proves manual/schedule gating, already-running, merge, mode dominance, due-time behavior, and the shared retry policy. |
| R2 | MET | `packages/domain/src/migrations.ts:668-692` installs the pending-or-processing unique index after deterministic duplicate retirement; `packages/domain/tests/db.test.ts:265-308`, `packages/domain/tests/db.test.ts:453-499`, and `packages/domain/tests/db.test.ts:560-605` prove cross-connection enqueue/claim exclusion and migration enforcement. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — All producers share one pending-or-processing invariant | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:157-249` and `packages/domain/tests/db.test.ts:453-499`; fresh `bun run spur-check` passed 6779 tests. |
| Scenario: R2 — Concurrent producers cannot bypass single-flight | MET | test | `packages/domain/tests/db.test.ts:265-308` races two SQLite connections and asserts one row/deterministic outcomes; `packages/domain/tests/db.test.ts:560-605` proves the index rejects a duplicate active row. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional, SECUA, and architecture verdicts PASS. |

**Verdict: approve.**

| Requirement | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:157-211` routes completion, schedule, and manual producers through one writer and preserves outcome/merge/due-time semantics; `packages/app/tests/services/history-refresh-service.test.ts:157-249` covers every producer and the shared `max_retries = 3` policy. |
| R2 | MET | `packages/domain/src/migrations.ts:668-692` installs the pending-or-processing unique index after deterministic duplicate retirement; `packages/domain/tests/db.test.ts:265-308`, `packages/domain/tests/db.test.ts:453-499`, and `packages/domain/tests/db.test.ts:560-605` prove cross-connection enqueue/claim exclusion and migration enforcement. |

SECUA: the database constraint remains the concurrency authority; conflict handling is bounded and fails loudly; other queue job types retain multiplicity. Architecture: the existing app writer/domain constraint seam is deep and directly testable; no new lock service or producer-specific path was introduced.

Resolved prior P4 observations: the unified retry value is asserted and documented as intentional in `docs/04_DESIGN.md` and `docs/design/history-refresh-process-isolation.md`; the event surface now documents and retains trigger/window/import-mode metadata.

Fresh checks: `bun run autofix` completed with all workspace typechecks passing; `cd packages/app && bun test tests/services/history-refresh-service.test.ts` passed 21 tests; `cd apps/server && bun test tests/index.test.ts` passed 4 tests.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-30T00:10:07.730Z todo → wip (system)
- 2026-08-30T00:33:08.196Z wip → testing (system)
- 2026-08-30T00:33:08.539Z testing → done (system)
