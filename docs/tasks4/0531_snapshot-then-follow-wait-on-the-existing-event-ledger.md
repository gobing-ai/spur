---
template: feature-impl
schema_version: 1
name: "Snapshot-then-follow wait on the existing event ledger"
description: ""
status: done
type: task
profile: standard
feature_id: G4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0530"]
ac_numbering: task-local
created_at: "2026-08-13T04:48:31.804Z"
updated_at: "2026-08-13T18:02:58.093Z"
---

## 0531. Snapshot-then-follow wait on the existing event ledger

### Background
Implements G4 R8 (ADR-057 wave 3). Depends on 0530 wait. Wave 2 may poll. This task extracts a shared snapshot-then-follow helper over `system_events` (and in-process EventBus when the server is the caller) so wait/reconnect does not grow a second event ring. Optional `agent report-state` only if `blocked` still cannot be derived after Wave 2.

Does not implement G3 Board un-merge, Board SSE (S6/W6), live handoff, or protocol ping unless CLI/`serve` skew is demonstrated in this task’s evidence.
### Requirements
- [x] R8. Extract `followSystemEventsAfter` (signature in Design) and switch 0530 wait onto it (no 100ms poll, no 512-event ring). Tests: gap/reconnect, pin break, empty follow-set. Update design satellite §8 to landed. Do **not** add `spur agent report-state` (deferred unless 0530 Testing contains `BLOCKED_UNREACHABLE`).
### Acceptance Criteria
```gherkin
Feature: Inter-agent control plane

  Scenario: R8 — Coordination wait snapshots then follows the existing event ledger
    Given a wait is in flight
    When it resumes after a gap
    Then it re-snapshots occupant + `system_events` sequence and follows `sequence > snapshot`
    And it does not allocate a separate in-memory event ring
```
### Q&A
- **Q: Block on Board SSE?** A: No. Closed 2026-08-12.
- **Q: Copy Herdr EventHub?** A: No. Closed 2026-08-12.
- **Q: Absorb G3?** A: No. Closed 2026-08-12.
- **Q: Land `report-state` in this task?** A: No. Only a future task if 0530 records `BLOCKED_UNREACHABLE`. Closed 2026-08-12.
### Design
WHAT: Shared ledger follow helper; switch 0530 wait onto it. No report-state verb.

WHY: Wave-2 poll is correct but not reconnect-safe. Herdr EventHub is the wrong model (`system_events.sequence` already exists — `0008` correlation columns).

WHERE:
- New `packages/app/src/services/system-event-follow.ts` + `packages/app/tests/services/system-event-follow.test.ts`.
- Change `occupant-wait.ts` follow hook only.
- `SystemEventDao` already persists `sequence` (`packages/domain` / `system_events`).

Frozen:
```
followSystemEventsAfter(getDb, { afterSequence: number, match: (row) => boolean, signal?: AbortSignal }): AsyncIterable<SystemEventRow>
```
Row fields used: `sequence`, `event_name`, `entity_id`, `run_id`, `payload_json`.

Anti-patterns: 512-event ring; Board SSE as prerequisite; `report-state` verb; G3 un-merge; new socket protocol; protocol ping.

Handoff from 0530: `waitForOccupant` already accepts a `follow` callback — replace the poll implementation.

Premise check (2026-08-12): `system_events.sequence` is in `SYSTEM_EVENTS_SCHEMA_SQL`. R8b frozen to skip.
### Plan
1. [x] R8 — Implement `followSystemEventsAfter` + DAO tests (gap, replay after snapshot, pin break).
2. [x] R8 — Wire 0530 `waitForOccupant` to the helper; delete ad-hoc poll.
3. [x] R8b — Confirm 0530 Testing lacks `BLOCKED_UNREACHABLE`; do not add `report-state`.
4. [x] R8c — Mark design satellite §8 landed.
5. [x] Regression: 0530 wait tests still pass.
### Solution
G4 R8 (ADR-057 wave 3) landed: shared snapshot-then-follow helper over the existing `system_events` ledger; 0530 wait consumes it. No `report-state` (R8b: 0530 Testing has no `BLOCKED_UNREACHABLE`). Change map:

| File | What/why |
| --- | --- |
| `packages/app/src/services/system-event-follow.ts:19-63` (new) | `followSystemEventsAfter(getDb, {afterSequence, match, signal?})` — AsyncIterable streaming rows with `sequence > afterSequence` ascending from the shared ledger (cursor, no event ring; `FOLLOW_POLL_INTERVAL_MS=100` keyset poll, batch 512). Abort + missing-table terminate cleanly. Raw SQL lives in the domain DAO (`raw-sql-only-in-domain`). |
| `packages/domain/src/dao/system-event-dao.ts:275-300` | `SystemEventDao.follow(afterSequence, limit?)` — ascending `sequence > ?` keyset query over `system_events`; missing table → `[]` (mirrors `query` safety). |
| `packages/app/src/services/occupant-wait.ts:107-111` | `OccupantWaitDeps.follow(afterSequence)` hook added — the wait consumes the follow stream instead of polling `latestInvokeEvent` every tick. |
| `packages/app/src/services/occupant-wait.ts:131-137` | `WaitStartSnapshot.latestInvoke` (name+sequence) so the loop can re-project lifecycle from the snapshot's latest event. |
| `packages/app/src/services/occupant-wait.ts:169-276` | `waitForOccupant` rewritten snapshot-then-follow: one in-flight follow read raced against a `POLL_INTERVAL_MS` heartbeat (deadline/stall/identity re-probe; a resolved read is never dropped). Invoke-exit keeps wave-2 `>=` semantics (exit at/after snapshot satisfies — 0530 CLI tests pin it). Identity/stall/timeout contract unchanged. |
| `packages/app/src/index.ts:281-285` | Export `followSystemEventsAfter` / `FollowSystemEventsOptions` / `FOLLOW_POLL_INTERVAL_MS`. |
| `apps/cli/src/commands/agent.ts:552-561` | `agent wait` wires `follow` = `followSystemEventsAfter(context.getDb, {match: pinned runId + invoke events, signal})`. |
| `apps/cli/src/commands/message.ts:184-194` | `message send --wait --until invoke-exit` wires the same follow. |
| `packages/app/tests/services/system-event-follow.test.ts` (new) | 7 tests: replay-after-snapshot/ascending, empty follow-set, gap/reconnect (no loss/dup), pin-break match filter, abort, missing ledger, production-shape auto-sequence. |
| `packages/app/tests/services/occupant-wait.test.ts:88-140` | Fakes gain the `follow` generator; fake `sleep` now uses a real timer — the follow-driven loop waits on the follow generator's poll timer, which a synchronously-resolving sleep starves (macrotask starvation under `bun test`). |
| `docs/design/inter-agent-control-plane.md:4-11,149-152,172-197` | Design satellite §8 marked landed; §6 wave-2 poll note updated; wave-split table row 3 notes follow helper landed, `blocked`/`report-state` deferred. |

Key decisions: identity re-probe stays on the heartbeat (wave-2 pin-break tests require detection without new events); `latestInvokeEvent` dep retained for the start snapshot only; invoke-exit `>=` semantics preserved (a snapshot-time exit satisfies — the 0530 CLI tests depend on it). No new noun, no report-state, no ring, no protocol ping.

Review-fix (pipeline review P1/P2, 0531): the reviewer proved production rows carry `sequence = NULL` (no producer sets it; `WHERE sequence > ?` excludes NULLs), so the follow could never deliver invoke events and mid-wait transitions were invisible — a regression vs 0530's per-tick re-read. Fixed at the root:

| File | What/why |
| --- | --- |
| `packages/domain/src/dao/system-event-dao.ts:117-144` | `insert` now auto-assigns a **global monotonic** sequence when omitted, via one atomic `INSERT ... SELECT` (`CASE WHEN ?9 IS NULL THEN COALESCE(MAX(sequence),0)+1`); explicit sequences (tests/backfills) honored verbatim. Single write path — every producer (emitter/tap/CLI) flows through it, so the follow cursor is populated in production and cross-run interleave (per-run counters) cannot skip pinned-run rows. |
| `packages/domain/src/migrations.ts:97,214-223,274` | `idx_system_events_sequence` added to `SYSTEM_EVENTS_SCHEMA_SQL` (fresh DBs) + migration `0011_spur_cli_system_events_sequence_idx` (existing ledgers, idempotent `0009` precedent) — the follow keyset poll and `MAX(sequence)` auto-assign both want an index. |
| `drizzle/0011_spur_cli_system_events_sequence_idx.sql` | Folder-loaded `spur migrate` path (`loadSqlMigrations(drizzle/)`) — same index DDL so the migrator tree is not missing 0011. |
| `packages/app/tests/services/system-event-follow.test.ts:177-211` | Production-shape regression guard: rows inserted without an explicit sequence get the global cursor and are followed (`[1, 2]`). |
| `packages/domain/tests/dao/system-event-dao.test.ts:308-357` | `insert` auto-assign tests: global (not per-run) cursor, monotonic alongside explicit sequences. |
| `docs/04_DESIGN.md:55,266-269` | Wave-3 wait blurb + satellite index row updated to landed. |
### Testing
**Re-verify 2026-08-13 (`/sp-dev-verify 0531 --auto --next --force --focus all --fix all`).** `--force` re-audit of an already-`done` task. Line anchors re-read this run. Fix pass: flipped R8 checklist `[ ]` → `[x]` (L3.unchecked-checklist). No UNMET/PARTIAL/major SECUA to repair.

**Verdict: PASS**

**Per-Requirement Traceability**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R8 | MET | Frozen helper `packages/app/src/services/system-event-follow.ts:19-26,44-63` (`followSystemEventsAfter(getDb, {afterSequence, match, signal?})`); keyset poll not a ring `packages/app/src/services/system-event-follow.ts:28-32` (`FOLLOW_POLL_INTERVAL_MS=100`, `FOLLOW_BATCH_SIZE=512` query batch); DAO `packages/domain/src/dao/system-event-dao.ts:275-300` (`follow(afterSequence)`); wait switched onto `deps.follow` `packages/app/src/services/occupant-wait.ts:107-111,131-137,169-276` (no per-tick `latestInvokeEvent` poll; identity heartbeat retained — Solution); CLI `apps/cli/src/commands/agent.ts:552-561` + `apps/cli/src/commands/message.ts:184-194`; export `packages/app/src/index.ts:281-285`; auto-assign sequence `packages/domain/src/dao/system-event-dao.ts:117-144`; tests `packages/app/tests/services/system-event-follow.test.ts:61-211` (replay:61-74, empty:76-95, gap/reconnect:97-124, pin-break:126-135, production-shape:177-211) + DAO `packages/domain/tests/dao/system-event-dao.test.ts:276-357`; satellite §8 landed `docs/design/inter-agent-control-plane.md:1-11,149-152,172-197`; `docs/04_DESIGN.md:266-269`; index `packages/domain/src/migrations.ts:97,214-223,274`; R8b — no `report-state` (`apps/cli` grep empty; 0530 Testing has no `BLOCKED_UNREACHABLE`) |

**Acceptance Criteria Verification**

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R8 — Coordination wait snapshots then follows the existing event ledger | MET | test | `bun test packages/app/tests/services/system-event-follow.test.ts` 7 pass / 0 fail this run (replay exclusive `sequence > snapshot`: `packages/app/tests/services/system-event-follow.test.ts:61-74`; empty follow-set:76-95; gap/reconnect no loss/dup:97-124). No separate ring: `packages/app/src/services/system-event-follow.ts:28-32,54`. Wait consumes follow: `packages/app/src/services/occupant-wait.ts:169-276` + 15/0 `packages/app/tests/services/occupant-wait.test.ts`. Production rows followed: `packages/app/tests/services/system-event-follow.test.ts:177-211`. 0530 CLI still green: `apps/cli/tests/commands/agent-wait.test.ts` 10/0, `apps/cli/tests/commands/message.test.ts` 35/0. Golden-path `spur agent wait ghost-spec --json` → `{error:{code:occupant_gone}}` exit 1. |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 6/7 claims DONE; 1 CHANGED (identity 100ms heartbeat retained — Solution; pin-break tests require it) |
| scope-creep | pass | Auto-assign sequence + `idx_system_events_sequence` are the review P1/P2 repair named in Solution, not drive-by |
| evidence-rule-pass | pass | Core AC has `test` evidence run this turn |
| cli-golden-path-present | pass | `bun run apps/cli/src/index.ts agent wait ghost-spec --json` → occupant_gone envelope, exit 1 |

**Targeted tests this run (all 0 fail; coverage-gate exit 1 is bunfig whole-graph, not assertion fail)**

- `system-event-follow.test.ts` — 7 pass / 0 fail; helper file 100% funcs / 95.24% lines
- `occupant-wait.test.ts` — 15 pass / 0 fail; `occupant-wait.ts` 100% lines
- `system-event-dao.test.ts` — 28 pass / 0 fail
- `migrations.test.ts` — 38 pass / 0 fail (includes `0011_spur_cli_system_events_sequence_idx`)
- `agent-wait.test.ts` — 10 pass / 0 fail
- `message.test.ts` — 35 pass / 0 fail

**Coverage:** `packages/app/src/services/system-event-follow.ts` 95.24% lines / 100% funcs; `packages/app/src/services/occupant-wait.ts` 100% lines (this-run targeted coverage tables).

**Fix-pass artifacts (gitignored; disclosed here):** `.spur/run/0531-verify-answer.txt`, `.spur/run/0531-verdict.json` rewritten this run after line-anchor re-read. `.spur/run/0531-fix-created.json` = `[]` (no follow-up tasks minted).

**`spur task check 0531 --strict-core --json`:** `pass: true` (pre-checkbox warning `L3.unchecked-checklist` — repaired this pass).

**`--next`:** no-op — task already terminal (`done`).
### Review
**SECUA + traceability review (0531 pipeline, 2026-08-13). Review by native reviewer subagent; fixes applied by controller; re-verified after fixes.**

| Prio | Dimension | Location | Finding | Status |
| --- | --- | --- | --- | --- |
| P1 | Correctness / Functional | `system-event-follow.ts`, `system-event-dao.ts` | Follow stream could never deliver `agent.invoke.*` in production — every producer omits `sequence`, so rows persist `NULL` and `WHERE sequence > ?` excludes them; mid-wait invoke transitions invisible → waits degraded to stall/timeout (regression vs 0530 per-tick re-read). Second facet: the column's documented per-run semantics would let cross-run interleave permanently skip pinned-run rows. | fixed — `SystemEventDao.insert` auto-assigns a global monotonic cursor via one atomic `INSERT ... SELECT` (single write path); production-shape regression test added; verify re-run below. |
| P2 | Efficiency | `migrations.ts` + `system-event-dao.ts` | No index on `sequence`; every 100 ms follow poll and every auto-assign did a table scan + sort. | fixed — `idx_system_events_sequence` in `SYSTEM_EVENTS_SCHEMA_SQL` + migration `0011`. |
| P3 | Correctness (test/doc) | `system-event-follow.test.ts` | "missing ledger terminates" overstates: the stream polls `[]` forever; only outer abort ends it. | accepted — DAO safety pattern is intentional (empty stream, heartbeat still runs); doc is accurate that no rows are yielded. |
| P3 | Docs drift | `docs/04_DESIGN.md` | Wait blurb still future tense for 0531. | fixed — updated to landed. |
| P4 | Test surface | fake-based wait tests | Fake follow generator cannot fail on the production data path. | accepted — real-shape DAO-level guard added (auto-assign test); wait-loop behavior unchanged. |

**Traceability (R8):**
- R8 ✓ — `followSystemEventsAfter` extracted, frozen signature, exported; 0530 wait switched onto it (no poll, no ring); gap/reconnect, pin break, empty follow-set tests; production-shape sequence test; satellite §8 landed; no `report-state` (R8b confirmed — 0530 Testing has no `BLOCKED_UNREACHABLE`).

**Disposition:** PASS after P1/P2 fixes. Residual risk low: sequence auto-assign is atomic under the single write path; `readLatestInvokeEvent` wall-clock tie-break is pre-existing 0530 behavior (out of scope).
### References
- Depends on 0530 (and transitively 0529). Feature G4 R8; ADR-057.
- `packages/domain/src/migrations.ts` `SYSTEM_EVENTS_SCHEMA_SQL`; `packages/app/src/services/system-event-emitter.ts`
- Not this task: G3/0197; S6/W6 SSE; `report-state`
### History
- 2026-08-13T17:20:47.985Z todo → wip (system)
- 2026-08-13T17:46:21.558Z wip → testing (system)
- 2026-08-13T17:47:18.112Z testing → done (system)
