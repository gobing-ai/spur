---
schema_version: 1
name: "Completion receipt: durable run-message-task correlation at run exit"
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.370Z
updated_at: "2026-09-13T06:49:52.928Z"
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

Re-audit fixes and current change map:

- `packages/app/src/services/agent-service.ts:1126` — request message IDs and task ID persisted before dispatch; unaddressed runs also receive a row
- `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition
- `packages/app/tests/services/agent-service.test.ts:30` — fresh real AiRunner/fake process integration observes exited receipt before notification; throwing listener leaves it durable
- `apps/cli/tests/commands/agent-team.test.ts:881` — fresh integration checks running row before dispatch and reopens disk SQLite to read terminal receipt, without a spec or request
- `packages/domain/tests/dao/coordination-run-dao.test.ts:216` — fresh pre-0044 upgrade test preserves existing rows; additive defaults and task index

Goal-equivalent Design corrections: receipt schema uses 0044 because 0043 belongs to request keys; message/task origin is also stored on insertStart for crash attribution. Empty spec_id represents an unaddressed run without inventing an occupant. The routed invoke-exit event is buffered until durable updateExit; notification failures cannot erase the receipt. No task advancement or new schema is added in this re-audit.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-service.ts:1126` — request message IDs and task ID persisted before dispatch; unaddressed runs also receive a row |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:30` — fresh real AiRunner/fake process integration observes exited receipt before notification; throwing listener leaves it durable |
| R3 | MET | `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition |
| R4 | MET | `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition |
| R5 | MET | `apps/cli/tests/commands/agent-team.test.ts:881` — fresh integration checks running row before dispatch and reopens disk SQLite to read terminal receipt, without a spec or request |
| R6 | MET | `packages/domain/tests/dao/coordination-run-dao.test.ts:216` — fresh pre-0044 upgrade test preserves existing rows; additive defaults and task index |
| R7 | MET | `apps/cli/tests/commands/agent-team.test.ts:980` — fresh regression preserves empty message list and no task advancement |
| R8 | MET | `apps/cli/tests/commands/agent-team.test.ts:923` — fresh drain integration verifies request/task association before invocation and after exit |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: A finished run is correlated back to its request and task | MET | test | `apps/cli/tests/commands/agent-team.test.ts:923` — fresh drain integration verifies request/task association before invocation and after exit; command: apps/cli: bun test tests/commands/agent-team.test.ts; packages/app: bun test tests/services/agent-service.test.ts tests/services/event-bridge.test.ts; packages/domain: bun test tests/dao/coordination-run-dao.test.ts (exit 0) |
| Scenario: Run exit is not task completion | MET | test | `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition; command: apps/cli: bun test tests/commands/agent-team.test.ts; packages/app: bun test tests/services/agent-service.test.ts tests/services/event-bridge.test.ts; packages/domain: bun test tests/dao/coordination-run-dao.test.ts (exit 0) |
| Scenario: A run with no originating request still records its outcome | MET | test | `apps/cli/tests/commands/agent-team.test.ts:881` — fresh integration checks running row before dispatch and reopens disk SQLite to read terminal receipt, without a spec or request; command: apps/cli: bun test tests/commands/agent-team.test.ts; packages/app: bun test tests/services/agent-service.test.ts tests/services/event-bridge.test.ts; packages/domain: bun test tests/dao/coordination-run-dao.test.ts (exit 0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### G61 forced re-audit — 0833

Verdict: PASS

Review coordinator: inline sp-super-reviewer; functional traceability, SECUA (security, efficiency, correctness, usability, architecture), and architecture-improvement lenses applied to current source and the fixes in this run.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | All | `packages/app/src/services/agent-service.ts:1473` | No unresolved blocker or major finding after this task's fixes; feature-level dependency failure remains owned by 0831. |

#### Functional traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/agent-service.ts:1126` — request message IDs and task ID persisted before dispatch; unaddressed runs also receive a row |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:30` — fresh real AiRunner/fake process integration observes exited receipt before notification; throwing listener leaves it durable |
| R3 | MET | `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition |
| R4 | MET | `packages/app/src/services/agent-service.ts:1473` — exit writes run/message/task correlation and run-exit-only or errored; no task transition |
| R5 | MET | `apps/cli/tests/commands/agent-team.test.ts:881` — fresh integration checks running row before dispatch and reopens disk SQLite to read terminal receipt, without a spec or request |
| R6 | MET | `packages/domain/tests/dao/coordination-run-dao.test.ts:216` — fresh pre-0044 upgrade test preserves existing rows; additive defaults and task index |
| R7 | MET | `apps/cli/tests/commands/agent-team.test.ts:980` — fresh regression preserves empty message list and no task advancement |
| R8 | MET | `apps/cli/tests/commands/agent-team.test.ts:923` — fresh drain integration verifies request/task association before invocation and after exit |

Verification: fresh bun run spur-check exit 0 (8496 tests, 99.21% functions / 98.99% lines), bun run test-cf exit 0, bun run build exit 0. Focused evidence and corrected Design deviations are recorded in Testing and Solution. No new public verb or dependency-local workaround.

--next: no-op - task already terminal (done). Existing done status is historical; the current verdict above is the re-audit result.

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

