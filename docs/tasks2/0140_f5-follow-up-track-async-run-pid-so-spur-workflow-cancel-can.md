---
template: issue
schema_version: 1
name: F5 follow-up — track async-run pid so `spur workflow cancel` can kill the in-flight subprocess
description: ""
status: done
type: task
profile: standard
parent_wbs: "0130"
priority: P3
tags: [bug]
dependencies: []
created_at: 2026-06-27T16:04:19.603Z
updated_at: 2026-06-27T23:39:01.276Z
---

## 0140. F5 follow-up — track async-run pid so `spur workflow cancel` can kill the in-flight subprocess

### Background

Child of 0130 (dogfood findings). Follow-up to 0138 (F5).

0138 shipped `spur workflow cancel <run-id>` as a discoverable single-run finalize verb, but DEFERRED the subprocess-kill half (R2): there is no runId→pid mapping. The async path does `Bun.spawn({...}).unref()` and discards the returned pid (`apps/cli/src/commands/workflow.ts:129-133`); the `runs` table has no pid column (`drizzle/0000_spur_cli_foundation.sql:11`). So `cancel` today marks the run record `failed` but cannot reach the live subprocess — an operator cancelling a long `agent.run` still has to kill the process by hand.

Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md. Prior task: docs/tasks2/0138_f5-spur-workflow-cancel-run-id-verb.md.

Files in scope: a migration adding a `pid` column to `runs` (packages/domain/src/migrations.ts + drizzle/), the async-spawn path in apps/cli/src/commands/workflow.ts (record the pid), and WorkflowService.cancel (packages/app/src/services/workflow-service.ts) — `process.kill(pid)` with alive-check + stale-pid tolerance before finalizing.

### Design

**Chosen approach — add a `pid` column via an incremental migration, capture the spawned pid in the
async path, and have `cancel` SIGTERM the live process before finalizing.**

The `runs` table is owned by the shared `@gobing-ai/ts-dual-workflow-engine` package
(`WORKFLOW_ENGINE_SCHEMA_SQL`), so Spur cannot edit its `0000` DDL. The column is added as a Spur-side
incremental migration instead — the same pattern `0001`–`0004` use for other engine-adjacent additions.

**1. Migration `0005_spur_cli_run_pid`** (`packages/domain/src/migrations.ts` + `drizzle/0005_*.sql`):

```sql
ALTER TABLE runs ADD COLUMN pid INTEGER;
```

SQLite has no `ADD COLUMN IF NOT EXISTS`, but the migration applier journals each migration by id
(`packages/domain/src/migrations.ts:115-131` — `existing != null → continue`), so each migration runs
**exactly once per database**. A plain `ALTER` is therefore safe: fresh DBs apply `0000` (no pid) then
`0005` (adds pid); existing DBs apply only `0005`. Collision risk: if the engine package ever adds its
own `pid` column to `runs`, this ALTER fails — flagged in a comment; acceptable until then.

**2. DAO methods** (`packages/domain/src/dao/run-dao.ts`):
- `setPid(runId, pid)` — `UPDATE runs SET pid = ? WHERE id = ?`.
- `getPid(runId)` — `SELECT pid FROM runs WHERE id = ?` (returns `number | null | undefined`).

**3. Capture the pid** (`apps/cli/src/commands/workflow.ts`, async branch): `Bun.spawn({...})` returns
a `Subprocess`; capture `subproc.pid` and persist it via the service before `unref()`ing. A tiny
`WorkflowService.recordRunPid(runId, pid)` wraps the DAO so the command layer stays thin.

**4. Kill in `cancel`** (`packages/app/src/services/workflow-service.ts`, the `cancel` method from
0138): after confirming the run is non-terminal, read its pid; if a pid is present, attempt
`process.kill(pid, 'SIGTERM')` inside a try/catch that treats `ESRCH` (no such process — already
dead/exited) as success, not an error. Then finalize as before. Rationale for SIGTERM over SIGKILL: let
the worker and its `agent.run` subprocess shut down cleanly; the run record is marked `failed`
regardless.

**Stale-pid tolerance (documented limitation).** A recorded pid could, in principle, have been
recycled to a different process by the time `cancel` runs. For a recently-spawned async run this is
low-risk and acceptable; we do **not** verify the kill target's identity (no portable way to do so
without reading `/proc` or shelling `ps`, which adds platform fragility). Documented in `cancel`'s
docstring + the task Review. The run-record finalization is the source of truth for "the run is
cancelled"; the SIGTERM is best-effort process cleanup.

**Rejected alternative — kill via a pidfile.** Rejected: another file artifact to manage, stale on
crash, and the DB already persists run state — a column is the natural home. Documented per R3.

**Surface touched.** `packages/domain/src/migrations.ts`, new `drizzle/0005_spur_cli_run_pid.sql`,
`packages/domain/src/dao/run-dao.ts` (+2 methods), `packages/app/src/services/workflow-service.ts`
(`recordRunPid` + kill logic in `cancel`), `apps/cli/src/commands/workflow.ts` (capture pid in async
branch), and tests in `packages/app/tests/services/workflow-service.test.ts` +
`packages/domain/tests/dao/migrations.test.ts`.

### Plan

- [ ] Add migration `0005_spur_cli_run_pid` (`ALTER TABLE runs ADD COLUMN pid INTEGER`) to
      `packages/domain/src/migrations.ts` (`RUN_PID_COLUMN_SCHEMA_SQL` const + `CLI_MIGRATIONS`
      entry) and the mirror file `drizzle/0005_spur_cli_run_pid.sql`. Comment the engine-ownership
      collision risk.
- [ ] `packages/domain/src/dao/run-dao.ts`: add `setPid(runId, pid)` and `getPid(runId)`.
- [ ] `packages/app/src/services/workflow-service.ts`: add `recordRunPid(runId, pid)`; extend
      `cancel(runId)` to read the pid, `process.kill(pid, 'SIGTERM')` (ESRCH tolerated), then
      finalize. Return the kill outcome in `WorkflowCancelResult` (e.g. `killed: boolean`).
- [ ] `apps/cli/src/commands/workflow.ts`: in the `--async` branch, capture `Bun.spawn`'s
      `.pid` and call `recordRunPid(runId, pid)` before `.unref()`.
- [ ] Update `packages/domain/tests/dao/migrations.test.ts` (the `CLI_MIGRATIONS` length/id
      assertions: 5 → 6, add `0005` id + an "existing DB gains pid column" test).
- [ ] Update `packages/app/tests/services/workflow-service.test.ts` cancel block: add a test that
      `cancel` SIGTERMs a recorded pid (use a real throwaway child process; assert it exits) and
      tolerates an already-dead pid (ESRCH).
- [ ] Gate: `bun run lint` clean; `bun test packages/domain packages/app apps/cli` green;
      `spur workflow cancel --help` unchanged surface.

### Root Cause
`spur workflow cancel <run-id>` (shipped in 0138) marks the run record `failed` but cannot reach the
live subprocess executing an async run. Two gaps:

1. **No pid is recorded.** The async path spawns the worker and discards the pid immediately:
   `apps/cli/src/commands/workflow.ts:129-133` does `Bun.spawn({...}).unref()` — the returned
   `Subprocess.pid` is never stored. So there is no runId→pid mapping to kill.
2. **No pid column.** The `runs` table (`drizzle/0000_spur_cli_foundation.sql:11`, owned by
   `WORKFLOW_ENGINE_SCHEMA_SQL` from `@gobing-ai/ts-dual-workflow-engine`) has no `pid` column, so
   even if the spawn captured the pid there is nowhere to persist it.

Root cause is the missing persistence + capture, not the kill mechanism itself (`process.kill` is
trivial once a pid is in hand).
### Solution
> ⚠️ **REVISED 2026-06-27 (post-review, option a).** The first implementation persisted the pid
> from the **launcher** right after `Bun.spawn`, then SIGTERMed that single pid. Review found two
> defects: (A) the launcher wrote `UPDATE runs SET pid… WHERE id=runId` **before the worker created
> the run row** → 0 rows matched → pid never persisted in real runs (only direct-`setPid` tests
> passed); (B) SIGTERM to the worker alone never reached the `agent.run` **grandchild**. Both are
> now fixed; the table below is the as-shipped state.

| File | What / Why |
|------|------------|
| `packages/domain/src/migrations.ts:83-99` | Added `RUN_PID_COLUMN_SCHEMA_SQL` (`ALTER TABLE runs ADD COLUMN pid INTEGER`) + registered the `0005_spur_cli_run_pid` migration in `CLI_MIGRATIONS`. The `runs` table is engine-owned, so the column is added as a Spur-side incremental migration (same pattern as 0001–0004). Journaled-once-per-DB makes the non-idempotent ALTER safe; comment flags the engine-collision risk. |
| `drizzle/0005_spur_cli_run_pid.sql:1` | Mirror file for the folder-based loader (`drizzle/*.sql` with the `_spur_cli_` marker). Byte-compatible with the embedded const. |
| `packages/domain/src/dao/run-dao.ts:129-145` | Added `setPid(runId, pid)` and `getPid(runId)` to `RunDao`. `getPid` returns `null` for runs with no recorded pid (sync runs, pre-column runs). |
| `packages/app/src/services/workflow-service.ts` (`WorkflowCancelResult`) | Extended with `killed: boolean`. |
| `packages/app/src/services/workflow-service.ts` (`signalSubprocess`) | **Defect B fix.** Now signals the **process group**: `process.kill(-pid, 'SIGTERM')` first (reaches the worker + its agent grandchild in one signal), falling back to `process.kill(pid, 'SIGTERM')` when the pid is not a group leader (sync run / no POSIX groups). ESRCH (already-dead) tolerated as `false`. |
| `packages/app/src/services/workflow-service.ts` (`withSelfPidRecording`) | **Defect A fix.** A Proxy over the persistence adapter that stamps `process.pid` onto the run row inside `createRun`/`createOrAttachRun` — i.e. the **worker self-records its own pid the instant the row exists**, eliminating the launcher-side race. Gated by `WorkflowRunOptions.recordSelfPid`. Best-effort (try/catch) so a pre-pid-column DB still runs. |
| `packages/app/src/services/workflow-service.ts` (`cancel`) | Reads the pid for non-terminal runs, group-SIGTERMs it via `signalSubprocess` (if recorded), then finalizes. Returns `killed`. Terminal/missing runs skip the kill. (The racy launcher-side `recordRunPid` method was removed.) |
| `apps/cli/src/commands/workflow.ts` (async branch) | **Defect B fix.** Switched from `Bun.spawn` to `child_process.spawn(spurBin, args, { detached: true, env: { …, SPUR_ASYNC_WORKER: '1' } })` so the worker is a session/process-group **leader** (its pid == group id). No launcher-side pid write — the worker self-records via `recordSelfPid` (set when `SPUR_ASYNC_WORKER=1`). |
| `apps/cli/src/commands/workflow.ts` (cancel output) | Human output notes `+ signalled worker process group` when `killed`. |
| `packages/app/tests/services/workflow-service.test.ts` | cancel tests updated for `killed`; added: single-process fallback kill, **group-leader kill** (detached `child_process.spawn` leader + grandchild reaped via `-pid`), already-dead ESRCH tolerance, `recordSelfPid` stamps `process.pid` at creation, no-pid run leaves pid null, and a pause+resume transparency check. |
| `apps/cli/tests/commands/workflow.test.ts` | **End-to-end async-cancel test** — real `--async` launch → detached worker self-records pid (polls the file DB; would stay null under Defect A) → `cancel` group-SIGTERMs → the `sleep 30` grandchild's group is reaped (would survive under Defect B) → run finalized `failed`. This is the live path the original stand-in test could not exercise. |
| `packages/domain/tests/dao/migrations.test.ts` | Migration-list assertions (5 → 6, +`0005` id), "run-pid migration adds pid column", realistic legacy-DB stub (includes `runs`), "runs table gains nullable pid column after migration". |

**Stale-pid tolerance (documented limitation).** A recorded pid could be recycled to a different
process by the time `cancel` runs; we SIGTERM without verifying the target's identity (no portable
way without `/proc`/`ps` fragility). Low-risk for recently-spawned async runs; the run-record
finalization is the source of truth, the SIGTERM is best-effort cleanup. Documented in `cancel`'s
docstring + Review.
### Testing
**Verification evidence (post-review, as shipped).**

- `bun run lint` clean — all 7 workspace typechecks pass; Biome no errors.
- `bun run test` → **1958 pass / 0 fail**; per-file coverage gate satisfied (the pid-recording
  Proxy refactor keeps `workflow-service.ts` at 95.9% func / 99.2% line).
- `bun run build` → succeeds across all workspaces.
- `bun test packages/app/tests/services/workflow-service.test.ts` → 38 pass — includes the
  **group-leader kill** test (detached `child_process.spawn` leader + a backgrounded grandchild;
  `cancel` reaps the whole group via `-pid`), the single-process fallback, ESRCH tolerance, and
  `recordSelfPid` stamping `process.pid` at run creation.
- `bun test apps/cli/tests/commands/workflow.test.ts` → 51 pass — includes the **live end-to-end
  async-cancel** test: it drives the real `--async` launcher → detached worker, polls the shared
  file DB until the worker self-records its pid (this would hang/fail under the original Defect A),
  cancels, and asserts the worker's whole process group (including the `sleep 30` grandchild) is
  reaped (would survive under the original Defect B), with the run finalized `failed`.

**Why the original evidence was insufficient (R12, honest correction).** The first round's kill
test used a `sleep 30` child created directly + `setPid` directly — it exercised `process.kill`
against a single pid but **bypassed the launcher→worker→createRun ordering** where Defect A lived,
and used a non-group-leader child so it could not reveal Defect B. The new end-to-end test runs the
actual code path and is the real proof the claim now holds.

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (root cause = no pid recorded + no pid column) | PASS | `runs.pid` added by `0005`; pid now recorded by the worker at row creation. |
| R2 (migration adds pid column; running process records it) | PASS | `0005_spur_cli_run_pid` + `setPid`; async worker self-records `process.pid` via `withSelfPidRecording` (`recordSelfPid` gated on `SPUR_ASYNC_WORKER=1`). Migration test confirms nullable INTEGER on fresh + legacy DBs; the e2e test confirms the pid actually persists in a live run. |
| R3 (cancel reads pid, kills with alive-check + ESRCH tolerance) | PASS | `cancel` → `signalSubprocess` → group `kill(-pid)` then single-pid fallback; ESRCH caught → `false`. Three kill tests (group, single, already-dead). |
| R4 (cancelling a running async run terminates its subprocess + marks failed) | PASS | The live end-to-end test asserts the worker's process group — including a real grandchild — is reaped and the run is `failed`. No stand-in caveat: this is the actual `--async` path. |
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | DONE | **Two defects found in code review and fixed (option a).** Defect A: launcher wrote the pid before the worker created the run row (0 rows updated → pid never persisted). Defect B: SIGTERM to the worker alone never reached the agent grandchild. Now: worker self-records its own pid at row creation; `cancel` group-SIGTERMs (`-pid`) to reap worker + grandchild. |
| P2 | DONE | runId→pid mapping shipped end-to-end: migration + DAO + self-pid Proxy + detached-leader spawn + group-kill, verified by a **live async-cancel test** (not a stand-in). 1958 tests green. |
| P3 (known limitation) | ACCEPTED | Stale-pid recycling: a recorded pid could belong to a different process if recycled. Not verified (no portable identity check). Low-risk for recent async runs; documented in `cancel` docstring. |

**Correctness.** The worker stamps `process.pid` synchronously inside the engine's `createRun`
hook — so the pid is recorded exactly when the row exists, with no race. Because the worker is
spawned `detached` (a session/group leader), its pid doubles as the group id, so
`process.kill(-pid, 'SIGTERM')` reaches the worker and the `agent.run` grandchild together; a
single-pid fallback covers non-leader pids (sync runs). ESRCH is tolerated. Terminal runs skip the
kill.

**Robustness.** Pid persistence is best-effort (try/catch in the Proxy) — a DB lacking the `pid`
column still runs and still finalizes on cancel, just without the group kill. Graceful degradation.

**Lesson (fed back).** The original "honest caveat" undersold its own gap: it said a live run
"would add confidence but not change the mechanism," when in fact a live run was the only thing
that could have caught either defect. Verifying the *mechanism in isolation* is not verifying the
*integration the feature claims* (R8). The end-to-end test is now the gate.
### References

### History
- 2026-06-27T16:35:16.035Z todo → wip (system)
- 2026-06-27T16:49:34.901Z wip → testing (system)
- 2026-06-27T16:49:43.397Z testing → done (system)
