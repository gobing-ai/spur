---
template: standard
schema_version: 1
name: F5 — spur workflow cancel <run-id> verb
description: ""
status: done
type: task
profile: standard
parent_wbs: "0130"
priority: P3
tags: []
dependencies: []
created_at: 2026-06-27T07:03:28.263Z
updated_at: 2026-06-27T16:03:44.546Z
---

## 0138. F5 — spur workflow cancel <run-id> verb

### Background

Child of 0130 (dogfood findings). Covers F5 (P3).

There is no dedicated stop verb for a running workflow. The operator must know that `spur workflow clean --older-than 0 --force` is the cancel path, and `clean`'s help frames it as "orphaned runs" so live-cancel is non-obvious. Cancelling also does not signal the AiRunner to kill the in-flight subprocess.

Source: docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md. Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md.

Files in scope: apps/cli/src/commands/workflow.ts (add the verb), apps/cli/src/index.ts (command registration). May touch the AiRunner signal path.

### Acceptance Criteria

```gherkin
Feature: F5 — spur workflow cancel <run-id> verb

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design

**Chosen approach — add a discoverable `spur workflow cancel <run-id>` verb that finalizes the
run as `failed`, and reframe `clean`'s help to surface the cancel use case.**

**Scope discovery (critical — R2 deferred).** The finding's R2 ("cancelling signals the AiRunner
to kill the in-flight subprocess") is **not achievable in this task's scope**: there is no
runId↔subprocess mapping anywhere. The async path does `Bun.spawn({...}).unref()` and discards the
PID (`apps/cli/src/commands/workflow.ts:129-133`); the `runs` table has no PID column
(`drizzle/0000_spur_cli_foundation.sql:11`). To kill an in-flight subprocess, Spur would first need
a PID-tracking layer (persist the spawned PID, handle orphaning/reparenting, cross-process kill,
stale-PID hygiene). That is a distinct, larger piece of infrastructure — split into a follow-up.
This task delivers R1 (the discoverable verb + finalize) and explicitly defers R2 with a recorded
follow-up. Surfacing this honestly per R12 rather than half-implementing a kill that can't reach
the subprocess.

**Surface touched.**

- `apps/cli/src/commands/workflow.ts` — add a `cancel <run-id>` subcommand. It calls a new
  `WorkflowService.cancel(runId)` that reuses the existing `RunDao.finalizeStale(runId, reason)`
  (`packages/domain/src/dao/run-dao.ts:116`) — idempotent against terminal runs, marks `failed`
  with a `cancelled by operator` reason. Reframe `clean`'s `.description()` to mention cancel as
  the bulk/stale variant.
- `packages/app/src/services/workflow-service.ts` — add `cancel(runId): Promise<WorkflowCancelResult>`
  mirroring `clean`'s shape. Reuses `finalizeStale`; returns `{ runId, finalized: boolean, status }`.

**Why this is the right split.** `finalizeStale` already does exactly what cancel needs (mark one
non-terminal run `failed` with a reason, idempotent vs terminal). No DAO change required — the verb
is a thin service+command wrapper over an existing primitive. The subprocess-kill (R2) is the part
that needs new infra; decoupling it lets R1 ship now and R2 land with the PID layer.

**R2 follow-up (recorded, not done here).** A new task: "track async-run PIDs so `spur workflow
cancel` can kill the in-flight subprocess." Scope: add a `pid` column to `runs` (migration),
record `Bun.spawn`'s returned PID in the async path, and have `cancel` `process.kill(pid)` (with
alive-check + stale-PID tolerance) before finalizing. Filed as a child of 0130 after this task closes.

**Invariant — cancel is safe and idempotent.** Finalizing a terminal run is a no-op (the DAO's
`status IN ('running','pending')` guard). Cancelling a non-existent run reports not-found. No data
loss beyond marking the run record `failed`.

### Plan
- [ ] `packages/app/src/services/workflow-service.ts`: add `cancel(runId)` returning
      `{ runId, finalized: boolean, status }`. Reuse `RunDao.finalizeStale(runId, 'cancelled by
      operator (spur workflow cancel)')`. `finalized: true` iff a row was actually transitioned
      (detect via a before/after status read — finalizeStale's WHERE guard means a terminal run
      yields `finalized: false`).
- [ ] `apps/cli/src/commands/workflow.ts`: add a `cancel <run-id>` subcommand with `--json`.
      Human output: `Cancelled run <runId>` / `Run <runId> already terminal (no change)` /
      `Run <runId> not found`. Reframe `clean`'s `.description()` to note it's the bulk/stale
      variant and point at `cancel` for a single live run.
- [ ] Test: add a `cancel` case to `apps/cli/tests/commands/workflow.test.ts` covering (a) a
      running run → finalized `failed`, (b) a terminal run → no-op, (c) a missing run → not-found.
- [ ] Verify: `bun run lint` + `bun test apps/cli/tests/commands/workflow.test.ts` green;
      `spur workflow --help` lists `cancel`.
- [ ] File the R2 follow-up task (PID tracking for subprocess kill) as a child of 0130.
### Solution

### Testing
**Verification evidence.**

- `bun run lint` clean — all 6 workspace typechecks pass (`spur-domain`, `spur`, `spur-contracts`,
  `spur-app`, `spur-web`, `spur-server`); Biome reports no errors.
- `bun test packages/app/tests/services/workflow-service.test.ts` → **32 pass / 0 fail** (was 29;
  +3 cancel tests: non-terminal→failed, terminal→no-op, missing→not_found).
- `bun test apps/cli/tests/commands/workflow.test.ts` → **50 pass / 0 fail** (no regression in
  the command wiring from the new subcommand + reframed `clean` description).
- `spur workflow --help` lists `cancel [options] <run-id>` and `clean`'s description now points at
  `cancel` for single live runs (discoverability confirmed).

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (discoverable `spur workflow cancel <run-id>` verb, or `clean` help reframed) | PASS (both) | New `cancel` subcommand present in `--help`; `clean` description reframed to point at it. 3 service tests + help check. |
| R2 (cancel signals AiRunner to kill in-flight subprocess) | **DEFERRED** | Not implementable without a runId→pid layer (none exists — `Bun.spawn().unref()` discards pid; no `pid` column in `runs`). Filed as a follow-up task. Documented in Design + Solution. |
| R3 (`cancel <run-id>` in `spur workflow --help`; cancelled run's subprocess terminated) | PARTIAL→deferred | The verb is in `--help` (PASS). The "subprocess terminated" half is the deferred R2. Honest partial, not claimed as full. |
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | n/a | No security/correctness issue; the verb reuses the battle-tested `finalizeStale` primitive |
| P2 | DONE | `spur workflow cancel <run-id>` shipped: discoverable, idempotent, 3 tests green |
| P3 (back-issue) | OPEN | R2 (subprocess kill) deferred — needs a PID-tracking layer first; filed as follow-up |

**Correctness.** `cancel` reuses `RunDao.finalizeStale`, whose `status IN ('running','pending')`
guard makes it idempotent against terminal runs and safe (no clobbering of `done`/`failed`). The
before/after status read computes `finalized` accurately. Missing runs report `not_found` without
writing.

**Honest scope.** This task deliberately ships R1 only and defers R2 with a recorded follow-up,
rather than pretending a subprocess kill works. The kill infrastructure (pid column + async-path
pid recording + `process.kill` with alive-check) is a distinct piece of work; half-implementing it
would be worse than an honest split (R12).

**No back-issues beyond R2.** Lint + 82 tests green; the new verb is purely additive (no change to
existing `clean`/`run`/`trace` behavior beyond `clean`'s help string).
### References

### History
- 2026-06-27T16:03:35.843Z todo → wip (system)
- 2026-06-27T16:03:35.931Z wip → testing (system)
- 2026-06-27T16:03:44.546Z testing → done (system)
