---
schema_version: 1
name: "Completion receipt: durable run-message-task correlation at run exit"
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.370Z
updated_at: "2026-09-12T07:40:51.603Z"
feature_id: G61

dependencies: ["0831"]
---

## 0833. Completion receipt: durable run-message-task correlation at run exit

### Background

**Probe 6 (ABSENT)** — nothing connects a finished run to the message or task that caused it. The
exit sink in `AgentService.executeRun` (`packages/app/src/services/agent-service.ts:1434-1444`,
inside the `finally`) writes only the occupant exit pin:

```ts
const status: 'exited' | 'errored' = result?.exitCode === 0 ? 'exited' : 'errored';
const refs = await this.resolveArtifactRefs(coordinationRunId);
await dao.updateExit(coordinationRunId, status, new Date().toISOString(), JSON.stringify(refs));
```

No message id, no task id. The message stays `injected` forever, `markDelivered` is never called on
the CLI path (see 0831), and nothing links a `runId` to a request
(`docs/reports/g6-runtime-inventory.md` §3, §5.2.1).

This is the load-bearing seam for the rest of the G6 program. Without it the orchestrator cannot be
woken by "result arrived" (G62 falls back to the 2000 ms drain poll), restart reconciliation has
nothing to reconcile (0834), and the Board cannot show a result state that survives refresh (G63).

**Correction (refinement, premise check). `coordination_runs` is Spur-owned, not ts-db's.** The DAO
is `packages/domain/src/dao/coordination-run-dao.ts:66` (raw SQL) and the DDL is
`COORDINATION_RUNS_SCHEMA_SQL` at `packages/domain/src/migrations.ts:122-136`, registered as step
`0010`. Receipt storage is therefore a **Spur-local additive migration**, not an engine change — which
closes G61's "receipt storage shape" open decision and corrects the G61 Notes line claiming receipt
storage is a `@gobing-ai/ts-db` facade change. (Task 0832's idempotency key *is* a ts-db change,
because `inbox_messages` really is ts-db's table. The two tasks touch different owners.)

**Correlation inputs already in scope at the sink.** `taskId` is read from flags at
`agent-service.ts:1033` and already threaded into `PromptOptions` at `:1194`. What is missing is the
originating message id — the CLI drain path knows it (0831's `claimed: string[]`) and never passes it
down.

Next free Spur migration prefix: **0043** (`drizzle/0042_spur_cli_history_model_fallback_index.sql`
is the last registered step; `migrations.ts:1288`).

### Requirements

- **R1** — A durable receipt records the association between `runId`, the originating message id(s),
  and the task id, written by the existing exit sink in `executeRun`.
- **R2** — The receipt is persisted **before** any notification is attempted; a failed notification
  leaves the result discoverable and re-deliverable rather than lost.
- **R3** — Delivery state, run state, and task verification stay distinct: message status is 0831's,
  run exit status is this task's, and task completion is asserted only by an existing workflow
  verification result. Nothing here advances a task.
- **R4** — A run that exits zero without a verification result is recorded as `run-exit-only`, a
  queryable value — not inferred later from the absence of something else.
- **R5** — Receipts are queryable by run id, by message id, and by task id, and survive a restart.
- **R6** — Storage is additive and reversible: nullable columns on `coordination_runs` plus indexes.
  **No config flag.** (Corrected during refinement — see Q&A.)
- **R7** — A run with no originating request still writes a receipt, with an empty message list rather
  than an invented association.
- **R8** — Probe 6 is rewritten as a regression asserting the correlation exists after exit.

### Acceptance Criteria

```gherkin
Feature: Completion receipt correlating run, message, and task

  @core
  Scenario: A finished run is correlated back to its request and task
    Given a worker completes a run started from a request
    When the run exits
    Then a durable receipt links runId, message id, and task id
    And the requester can read the outcome after a process restart

  @core
  Scenario: Run exit is not task completion
    Given a run that exits zero without a workflow verification result
    When the outcome is reported
    Then it is recorded as run-exit-only and the task is not advanced

  @core
  Scenario: A run with no originating request still records its outcome
    Given a run started outside the request path
    When it exits
    Then a receipt is written without inventing a request association
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:10:02.713Z

- **Receipt storage shape (G61 open decision) — CLOSED: extend `coordination_runs`.** Premise check
  found the table is Spur-owned (`packages/domain`), so extending it is a local additive migration with
  no engine release in the loop. A separate receipt table would duplicate `run_id`, `spec_id`, and the
  artifact refs that already live on this row, and would need its own lifecycle against the same sink.
- **G61 Notes correction.** "Receipt storage is an additive `@gobing-ai/ts-db` facade change" is wrong
  and should be amended at the feature: only 0832's idempotency key touches ts-db.
- **R6's config flag — CLOSED: no flag.** The original wording ("rollback by keeping the sink behind a
  config flag defaulting off") would ship the seam dark, and every downstream feature — 0834, 0839,
  0844 — depends on receipts existing. Rollback is already covered: the columns are nullable/defaulted
  and the sink is warning-only on failure. Robin owns the final call.
- **Multiple messages per run — CLOSED: JSON array.** A drain claims up to 100 messages into one
  invocation, so the correlation is genuinely one-to-many. `message_ids_json` mirrors the table's
  existing `artifact_refs_json` idiom; json1 `json_each` serves query-by-message and was verified
  available in this runtime.
- **Deferred (owner: workflow verification path, outside G61).** Writing `outcome = 'verified'`. This
  task only establishes the value and guarantees the exit sink never writes it.

### Design

**WHAT.** Widen the row the exit sink already writes so it carries the request correlation, and thread
the originating message ids down to it.

**WHY here.** `executeRun`'s `finally` is the one place that runs for every invocation, holds
`coordinationRunId`, `taskId`, and the result, and already writes a durable row. Adding a second sink
elsewhere would create two writers for one fact.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/domain/src/migrations.ts:122-136` | widen `COORDINATION_RUNS_SCHEMA_SQL`; register step `0043` |
| `drizzle/0043_spur_cli_coordination_runs_receipt_columns.sql` | byte-compatible ALTER statements |
| `packages/domain/src/dao/coordination-run-dao.ts` | `updateExit` gains a receipt argument; three query verbs |
| `packages/app/src/services/agent-service.ts:1434-1444` | pass the receipt at the existing call |
| `apps/cli/src/commands/agent.ts` | pass claimed ids into flags (0831 supplies `claimed`) |

**Frozen names — schema.** Three additive columns on `coordination_runs`:

- `message_ids_json TEXT NOT NULL DEFAULT '[]'` — the originating message ids. A JSON array because a
  single drain can claim up to 100 messages into one invocation; mirrors the table's existing
  `artifact_refs_json` idiom rather than inventing an edge table.
- `task_id TEXT` — nullable; the `--task` flag value when the run came from task work.
- `outcome TEXT NOT NULL DEFAULT 'run-exit-only'` — closed vocabulary
  `'run-exit-only' | 'errored' | 'verified'`.

Plus `CREATE INDEX IF NOT EXISTS idx_coordination_runs_task ON coordination_runs (task_id)`.
Query-by-message uses SQLite's json1: `SELECT r.* FROM coordination_runs r, json_each(r.message_ids_json)
WHERE json_each.value = ?`. json1 was verified available in this runtime (`bun:sqlite`, in-memory
probe) during refinement. Migration follows the `drizzle/0041_spur_cli_queue_jobs_deadline_lease_columns.sql`
precedent: plain `ALTER TABLE … ADD COLUMN`, byte-compatible with the schema constant, registered with
an `addColumnIfMissing` guard per column.

**Frozen names — code.**

- `CoordinationRunReceipt { messageIds: string[]; taskId?: string; outcome: 'run-exit-only' | 'errored' | 'verified' }`
  in `packages/domain/src/dao/coordination-run-dao.ts`.
- `CoordinationRunDao.updateExit(runId, status, completedAt, artifactRefsJson, receipt)` — the receipt
  becomes a required fifth argument so no caller can forget it; `{ messageIds: [], outcome: … }` is the
  legitimate empty case (R7).
- `CoordinationRunDao.listByMessageId(msgId)`, `listByTaskId(taskId)`; `getByRunId` already exists (R5).
- Flags `requestMessage` / `request-message` on the agent run path — a comma-joined id list, read with
  `stringFlag(flags, 'requestMessage', '')` and following the existing dual-spelling convention used by
  `sessionDir` / `session-dir` at `agent-service.ts:1034-1035`. `drainIntoPrompt` writes it from 0831's
  `claimed` array.

**Outcome precedence at the sink.** `result?.exitCode === 0 ? 'run-exit-only' : 'errored'`. `'verified'`
is **never** written by this sink — only the workflow verification path may write it, and wiring that
writer is out of scope here. That is what keeps run exit from masquerading as task completion (R3, R4).

**Ordering (R2).** The receipt is written by the existing `updateExit` call, which already precedes
every notification — 0831's `settleDelivered` runs in the CLI command layer after `svc.run` returns,
i.e. strictly after this write. Preserve that order; do not move settle earlier.

**Anti-patterns — do not implement.**

- Do not add a second sink or a new receipts table — widen the row that already exists.
- Do not write `'verified'` from the exit sink, and do not advance a task from here.
- Do not touch ts-db; `coordination_runs` is Spur's (see Background).
- Do not make the new columns `NOT NULL` without a default — existing rows must survive the migration.
- Do not infer the message id from the recipient or the most recent queued row; if it was not passed
  down, the list is empty.
- Do not swallow a receipt write failure silently beyond the existing warning-only behavior of this
  block, and do not fail the run because the receipt write failed.

**Handoff.** 0834 reconciles on `outcome` and the empty-vs-populated message list; G62's event-driven
wakeup (0839) triggers on receipt writes; G63's result states (0844) render `outcome` — with
`run-exit-only` labeled unverified.

### Plan

1. Widen `COORDINATION_RUNS_SCHEMA_SQL` with the three columns and the task index; add
   `drizzle/0043_spur_cli_coordination_runs_receipt_columns.sql` with byte-compatible ALTERs; register
   step `0043` with an `addColumnIfMissing` guard per column. (R6)
2. Add `CoordinationRunReceipt`, extend `updateExit` to require it, and add `listByMessageId` /
   `listByTaskId` to `CoordinationRunDao`. (R1, R5)
3. DAO tests on in-memory SQLite: receipt round-trips; query by message id, task id, run id; an empty
   message list is a valid receipt; the migration is idempotent against a pre-0043 table. (R5, R6, R7)
4. At `agent-service.ts:1434-1444`, build the receipt from `taskId`, the `requestMessage` flag, and the
   exit code, and pass it to `updateExit`. (R1, R4)
5. In `apps/cli/src/commands/agent.ts`, write `claimed` (from 0831) into the rewritten flags as
   `requestMessage` on both the `runAgentRun` and `runAgentLoop` drain paths. (R1)
6. Rewrite probe 6 as a regression: after a drained run exits, the `coordination_runs` row carries the
   message id and the task id, and `outcome` is `run-exit-only` for a zero exit with no verification. (R8)
7. Add a regression that a run with no originating request still writes a row with `messageIds: []`. (R7)
8. `cd packages/domain && bun test` and `cd apps/cli && bun test tests/commands/agent-team.test.ts`,
   then `bun run spur-check`.

### Solution

**Spec drift correction applied (logged in run ledger):** the spec's "next free Spur migration prefix:
**0043**" is stale — 0043 is taken by 0832's `0043_spur_cli_inbox_messages_request_key`
(`drizzle/0043_…`, registered at `packages/domain/src/migrations.ts:1357`). Everything the spec calls
0043 for the receipt migration was renumbered to **0044**:
`drizzle/0044_spur_cli_coordination_runs_receipt_columns.sql`, step id
`0044_spur_cli_coordination_runs_receipt_columns`. Everything else in the spec stands unchanged.

Change map:

| Layer | Change |
| --- | --- |
| `packages/domain/src/migrations.ts:140-176` | `COORDINATION_RUNS_SCHEMA_SQL` widened with `message_ids_json TEXT NOT NULL DEFAULT '[]'`, `task_id TEXT`, `outcome TEXT NOT NULL DEFAULT 'run-exit-only'` + `idx_coordination_runs_task` (frozen names; column order matches the 0044 ALTER order byte-for-byte) |
| `packages/domain/src/migrations.ts:178-196` | new `COORDINATION_RUNS_RECEIPT_COLUMNS_SCHEMA_SQL` — three narrow ALTERs + the task index, the 0041 queue-jobs precedent |
| `packages/domain/src/migrations.ts:1358-1366` | step `0044_spur_cli_coordination_runs_receipt_columns` registered with `addColumnIfMissing: { coordination_runs, message_ids_json }` |
| `packages/domain/src/migrations.ts:1593-1597,1649` | table-absence skip guard (0041/0043 precedent): DBs without `coordination_runs` (the drizzle folder-load path ships no 0010 step) journal without executing |
| `drizzle/0044_spur_cli_coordination_runs_receipt_columns.sql` | folder-load mirror, byte-compatible with the constant |
| `packages/domain/src/dao/coordination-run-dao.ts:52-69` | `CoordinationRunReceipt { messageIds, taskId?, outcome }`; `CoordinationRunRow` widened with the three columns |
| `packages/domain/src/dao/coordination-run-dao.ts:105-156` | `updateExit` gains the REQUIRED 5th `receipt` argument; `listByMessageId` (json1 `json_each`), `listByTaskId`; `getByRunId` SELECT widened |
| `packages/domain/src/dao/index.ts:16` | `CoordinationRunReceipt` re-exported |
| `packages/app/src/services/agent-service.ts:1041-1045` | `requestMessageIds` parsed from the `requestMessage`/`request-message` flags (dual-spelling per `sessionDir`); absent flag → empty list, never inferred (R7) |
| `packages/app/src/services/agent-service.ts:1448-1466` | exit sink builds the receipt — `outcome = result?.exitCode === 0 ? 'run-exit-only' : 'errored'`; **never** `'verified'` from this sink — and passes it to the existing `updateExit` call, which still precedes every notification (R2) |
| `apps/cli/src/commands/agent.ts:640-649` | `drainIntoPrompt` writes 0831's claimed ids into the rewritten flags as comma-joined `requestMessage` + `request-message` (both `runAgentRun` and `runAgentLoop` drain paths route through here) |

Untouched by design: no second sink, no receipts table, no ts-db change, no task advancement, no
config flag, `NOT NULL` columns all defaulted so pre-0044 rows survive (R6).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-service.ts:1454-1466` — exit sink builds CoordinationRunReceipt and passes it to the single updateExit; ids via requestMessage flags `agent-service.ts:1041-1045`, written from 0831 claimed in `apps/cli/src/commands/agent.ts:640-649`; round-trip test `packages/domain/tests/dao/coordination-run-dao.test.ts:116-142` |
| R2 | MET | Receipt written in executeRun's finally `packages/app/src/services/agent-service.ts:1447-1471`; settleDelivered runs in CLI after svc.run returns (`apps/cli/src/commands/agent.ts:479` vs `:567,:578,:825`) — strictly after the receipt write |
| R3 | MET | Sink outcome vocabulary only 'run-exit-only'/'errored', never 'verified' (`packages/app/src/services/agent-service.ts:1457-1459`); probe asserts delivery stays 'delivered' and task not advanced (`apps/cli/tests/commands/agent-team.test.ts:961-964`) |
| R4 | MET | Zero exit with no verification stored as 'run-exit-only' (`packages/app/src/services/agent-service.ts:1458`); asserted stored-not-inferred `apps/cli/tests/commands/agent-team.test.ts:952-954`; nonzero-exit records 'errored' `apps/cli/tests/commands/agent-team.test.ts:1000-1020` |
| R5 | MET | `packages/domain/src/dao/coordination-run-dao.ts:126-158` — listByMessageId (json1 json_each), listByTaskId, getByRunId SELECT widened; query tests `packages/domain/tests/dao/coordination-run-dao.test.ts:144-182`; probe reads by message id + run id post-exit `apps/cli/tests/commands/agent-team.test.ts:946-958` |
| R6 | MET | Additive nullable/defaulted columns + idx_coordination_runs_task `packages/domain/src/migrations.ts:158-172`; ALTER constant `:175-183`; step 0044 with addColumnIfMissing `:1363-1366`; byte-compatible drizzle mirror `drizzle/0044_spur_cli_coordination_runs_receipt_columns.sql:9-12` asserted statement-identical `packages/domain/tests/dao/migrations.test.ts:849-861`; idempotent on pre-0044 table with surviving row `packages/domain/tests/dao/coordination-run-dao.test.ts:216-270`; no config flag |
| R7 | MET | Absent flag → empty list, never inferred `packages/app/src/services/agent-service.ts:1041-1045`; empty receipt valid DAO case `packages/domain/tests/dao/coordination-run-dao.test.ts:189-212`; CLI regression message_ids_json='[]', no invented inbox traffic `apps/cli/tests/commands/agent-team.test.ts:967-999` |
| R8 | MET | Probe 6 rewritten as three regressions in describe 'G61 completion receipt regressions (0833)' `apps/cli/tests/commands/agent-team.test.ts:911-1040`: correlation+state-distinctness (912), R7 empty receipt (967), nonzero-exit errored (1000) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A finished run is correlated back to its request and task | MET | test | `apps/cli/tests/commands/agent-team.test.ts:912-964` — drained run exits, coordination_runs row carries msgId + task_id, readable by listByMessageId and getByRunId after exit; plus `packages/domain/tests/dao/coordination-run-dao.test.ts:116-182` |
| Run exit is not task completion | MET | test | `apps/cli/tests/commands/agent-team.test.ts:952-964` — outcome stored 'run-exit-only', delivery stays 'delivered', task not advanced; sink never writes 'verified' (`packages/app/src/services/agent-service.ts:1457-1459`) |
| A run with no originating request still records its outcome | MET | test | `apps/cli/tests/commands/agent-team.test.ts:967-999` — no-drain run writes receipt with message_ids_json='[]', task id recorded, no invented inbox traffic; plus `packages/domain/tests/dao/coordination-run-dao.test.ts:189-212` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0833 (2026-09-12, pipeline Phase 7, profile=auto mode=safety)

**Scope:** 0833 diff surface on HEAD 3761051f9 — migrations.ts (140-176, 1358-1366, 1593-1597), drizzle/0044, coordination-run-dao.ts (63-160) + dao/index.ts:16, agent-service.ts (1041-1045, 1448-1466), agent.ts (640-649), domain dao/migrations tests, agent-team.test.ts:911+. 0831/0832 changes in the worktree excluded per review charter.
**Dimensions:** functional (R1-R8), SECUA quality, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | `status` and `receipt.outcome` are derived from the same `result?.exitCode === 0` expression, so until the deferred verification writer lands, `outcome` is a function of `status`. Intentional per spec Q&A (deferred, owner: workflow verification path) — re-check divergence when that writer exists. | `packages/app/src/services/agent-service.ts:1452-1458` |
| 2 | P4 (advisory) | correctness | Receipt and exit pin share one try block: a `resolveArtifactRefs` throw skips the receipt write too, warning-only. Matches the sink's pre-existing failure posture and the "never fail the run" anti-pattern guard, but receipt durability is bounded by refs resolution succeeding. | `packages/app/src/services/agent-service.ts:1448-1471` |
| 3 | P4 (advisory) | architecture | `applyCliMigrations` skip-guard handling is now ~20 hand-named booleans plus a compound `if`; 0044 correctly follows the 0041/0043 precedent but the pattern accretes. Future consolidation: a declarative `skipIf(adapter)` field on `CliMigration`. Out of scope here. | `packages/domain/src/migrations.ts:1570-1650` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Receipt written by the existing exit sink: `agent-service.ts:1454-1466` builds `CoordinationRunReceipt` and passes it to the single `updateExit`; ids arrive via `requestMessage` flags (`agent-service.ts:1041-1045`) written from 0831's `claimed` in `drainIntoPrompt` (`agent.ts:640-649`), which both `runAgentRun` (:547) and `runAgentLoop` (:817) route through. |
| R2 | MET | `updateExit` runs in `executeRun`'s `finally` before the promise resolves; `settleDelivered` runs in the CLI after `svc.run` returns (`agent.ts:479` vs :567/:578/:825) — strictly after. |
| R3 | MET | Sink writes only `run-exit-only`/`errored`, never `verified` (`agent-service.ts:1457`); no task advancement anywhere in the sink; probe regression asserts delivery stays `delivered` and task untouched (`agent-team.test.ts:961-964`). |
| R4 | MET | Zero exit with no verification stored as `run-exit-only` (`agent-service.ts:1457`), asserted stored-not-inferred in probe 6 flipped (`agent-team.test.ts:952-954`) and the nonzero-exit regression asserts `errored`. |
| R5 | MET | `getByRunId` (pre-existing, SELECT widened), new `listByMessageId` (json1 `json_each`) and `listByTaskId` (`coordination-run-dao.ts:126-158`); rows durable in `coordination_runs`; probe asserts post-exit read by message id and run id. |
| R6 | MET | Additive nullable/defaulted columns + `idx_coordination_runs_task` (`migrations.ts:140-176`, constant and `drizzle/0044` byte-compatible — asserted statement-identical at `migrations.test.ts:849-861`); no config flag. Idempotency proven against a pre-0044 table with a surviving row (`coordination-run-dao.test.ts:216-280`); table-absent DBs journal without executing (`migrations.ts:1593-1597`). |
| R7 | MET | Absent flag → empty list, never inferred (`agent-service.ts:1041-1045` comment + code); empty receipt a first-class DAO case (`coordination-run-dao.test.ts:189`) and a CLI regression with `message_ids_json = '[]'` and no invented inbox traffic (`agent-team.test.ts:968-999`). |
| R8 | MET | Probe 6 rewritten as three regressions in `G61 completion receipt regressions (0833)` (`agent-team.test.ts:911-1080`): correlation+delivery-distinctness, R7 empty receipt, nonzero-exit `errored`. |

SECUA: parameterized SQL throughout (no injection surface); json1 fed only by DAO-written `JSON.stringify` values or the `'[]'` default; no secrets/stdout bodies stored (path-only refs, unchanged); no ts-db change. Architecture: `CoordinationRunDao` stays deep — the correlation widened the row and one required argument, not the caller surface; `CoordinationRunReceipt` re-exported (`dao/index.ts:16`); no second sink, no receipts table. Spec-drift renumber 0043→0044 (0832 took 0043) verified collision-free: registry index 44 with `addColumnIfMissing: { coordination_runs, message_ids_json }` (`migrations.test.ts:188-190`), legacy-stub/journal counts bumped, 0022-0044 convergence test retitled.

**Gate evidence (fresh, this review):** `bun run spur-check` rc 0 — 8054 pass, 0 fail (445 files); `packages/domain` dao+migrations subset 64 pass; `apps/cli` agent-team 37 pass; `packages/app` 2844 pass, 0 fail.

**Residual risk:** (a) comma-joined `requestMessage` flag transport would mis-split an id containing `,` — no such id exists in the current inbox id space (probe round-trips real enqueued ids), and the list is also carried directly in `drainIntoPrompt`'s return; (b) `outcome='verified'` writer is deferred outside G61 — 0834/G63 consumers must treat `run-exit-only` as unverified until it lands; (c) receipt durability bounded by `resolveArtifactRefs` (finding 2).

**Next:** No blocking findings — proceed to the 0833 approve gate; findings 1-3 are record-only P4s.

### References

- Parent feature: [G61 — Durable project command and result loop](../features/G61_durable-project-command-and-result-loop.md)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §3 probe 6, §5.2.1, §5.3
- Intended semantics: [strategy prototype](../reports/g6-strategy-prototype.md) §2 (attempt identity, notification failure), §3 (exit-as-task-success, notification failure cases)
- Reuses: G4 occupant identity / coordination run records; G1 message events

### History

- 2026-09-12T04:57:17.929Z backlog → todo (system)
- 2026-09-12T06:52:13.606Z todo → wip (system)
- 2026-09-12T07:40:50.806Z wip → testing (system)
- 2026-09-12T07:40:51.603Z testing → done (system)

