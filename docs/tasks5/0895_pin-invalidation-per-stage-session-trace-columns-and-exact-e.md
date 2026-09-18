---
schema_version: 1
name: Pin invalidation, per-stage session trace columns, and exact E6 run-to-session mapping for pinned stages
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.556Z
updated_at: "2026-09-18T14:03:08.845Z"
feature_id: B7
priority: P1
tags:
  - workflow
  - trace
  - E6
  - B7
estimate_hours: 6

dependencies: ["0894", "0891"]
---

## 0895. Pin invalidation, per-stage session trace columns, and exact E6 run-to-session mapping for pinned stages

### Background

Task 7 pins one executor per role for the run. A pin can go stale when task 4's drain disables the executor mid-run, and nothing yet shows per-stage executor/session in the trace or feeds E6's run→session correlation (0 mapped rows today). Authority: `docs/design/session-pinned-dispatch.md` §4 (pin invalidation, trace), AC R6/R7/R8; feature E6 R2.

### Requirements

- [x] R1. Before each `agent.run`, the pinned executor's current availability is read through the loader (cache-invalidated by task 4); if disabled, the role is re-resolved exactly once for the run, the trace records `pin-reresolved` with the owner/reason, and the stage starts a fresh session.
- [x] R2. Each `agent.run` trace row carries `executor`, `sessionId` and `session: reused | fresh`; `spur workflow trace <run> --json` exposes them and the table renders them.
- [x] R3. For a stage that resumed a pinned session, the E6 correlation records the exact run → session mapping (no heuristic match) using the session id the agent accepted; a resumed stage yields one mapped row.
- [x] R4. Tests cover the mid-run disable path (re-resolve once, second disable fails the stage with the ADR-118 outcome), trace fields, and the E6 mapping row; `bun run spur-check` passes.

### Acceptance Criteria

- [x] AC1 — The trace shows executor and session per stage (req: R2)
- [x] AC2 — A pin is re-resolved when its executor is disabled mid-run (req: R1)
- [x] AC3 — Stage cost attributes to the executor through the session mapping (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: invalidation is a read of the same loader the drain invalidates, not a subscription — one pin check per stage is cheap and needs no event plumbing (docs/design/session-pinned-dispatch.md §4). Re-resolve happens once per run per role: a second disable means the ladder is exhausted for that tier and the stage should fail loudly rather than hunt. Trace columns are the measurement the whole program depends on; E6 gets its first exact rows from resumed stages. Mutation policy: `agent-run.ts` pre-spawn check, trace projection (`progress-projection.ts` / trace renderer), E6 correlation writer, tests; no workflow YAML changes beyond what task 7 declared.

### Plan

1. Read design §4 (invalidation, trace), task 7's pin shape, the trace projection code, and E6's correlation writer.
2. Add the pre-spawn availability read + single re-resolve; record the trace note.
3. Add the three trace fields end to end (action result → projection → CLI table/JSON).
4. Wire the exact E6 mapping for resumed stages; write the tests.
5. Run `cd packages/app && bun test tests/workflow/` and `cd apps/cli && bun test tests/commands/workflow*` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/commands/workflow.test.ts:3032` |
| `packages/app/src/services/agent-service.ts:1819` |
| `packages/app/src/services/agent-service.ts:1991` |
| `packages/app/src/services/agent-service.ts:2210` |
| `packages/app/src/services/agent-service.ts:2260` |
| `packages/app/src/services/agent-service.ts:2277` |
| `packages/app/src/services/agent-service.ts:2368` |
| `packages/app/src/services/agent-service.ts:455` |
| `packages/app/src/services/workflow-service.ts:1850` |
| `packages/app/src/services/workflow-service.ts:2400` |
| `packages/app/src/workflow/actions/agent-run.ts:1044` |
| `packages/app/src/workflow/actions/agent-run.ts:1086` |
| `packages/app/src/workflow/actions/agent-run.ts:1089` |
| `packages/app/src/workflow/actions/agent-run.ts:1093` |
| `packages/app/src/workflow/actions/agent-run.ts:20` |
| `packages/app/src/workflow/actions/agent-run.ts:236` |
| `packages/app/src/workflow/actions/agent-run.ts:3` |
| `packages/app/src/workflow/actions/agent-run.ts:305` |
| `packages/app/src/workflow/actions/agent-run.ts:319` |
| `packages/app/src/workflow/actions/agent-run.ts:338` |
| `packages/app/src/workflow/actions/agent-run.ts:343` |
| `packages/app/src/workflow/actions/agent-run.ts:349` |
| `packages/app/src/workflow/actions/agent-run.ts:373` |
| `packages/app/src/workflow/actions/agent-run.ts:404` |
| `packages/app/src/workflow/actions/agent-run.ts:461` |
| `packages/app/src/workflow/actions/agent-run.ts:468` |
| `packages/app/src/workflow/actions/agent-run.ts:517` |
| `packages/app/src/workflow/actions/agent-run.ts:562` |
| `packages/app/src/workflow/actions/agent-run.ts:58` |
| `packages/app/src/workflow/actions/agent-run.ts:997` |
| `packages/app/src/workflow/actions/doctor-probe.ts:10` |
| `packages/app/src/workflow/actions/doctor-probe.ts:126` |
| `packages/app/src/workflow/actions/doctor-probe.ts:198` |
| `packages/app/src/workflow/actions/doctor-probe.ts:2` |
| `packages/app/src/workflow/actions/doctor-probe.ts:61` |
| `packages/app/src/workflow/actions/doctor-probe.ts:75` |
| `packages/app/src/workflow/actions/doctor-probe.ts:82` |
| `packages/app/src/workflow/builtins.ts:97` |
| `packages/app/src/workflow/observability.ts:244` |
| `packages/app/src/workflow/observability.ts:295` |
| `packages/app/tests/services/agent-service.test.ts:1930` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2002` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2035` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2137` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2147` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2149` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2185` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2187` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2194` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2313` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2494` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2886` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2889` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2913` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2947` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2953` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3113` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:109` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Availability read through the live loader pre-spawn: `packages/app/src/workflow/actions/agent-run.ts:259-263` → `AgentService.executorAvailability` re-reads config via `reloadAgentConfig` (`packages/app/src/services/agent-service.ts:463-468`). Re-resolve exactly once per run: latch check `agent-run.ts:266-274` (second disable → loud ADR-118-cited failure), `resolveRoleFresh` live-roster walk `agent-service.ts:501-521`, fresh pin + marker persisted via setVars `agent-run.ts:1094-1104`; stage forced fresh via `pinReresolved !== undefined` (`agent-run.ts:323`); trace records the hop with owner/reason `agent-run.ts:1059-1064` → projected `workflow-service.ts:2408-2411`. Tests: `packages/app/tests/workflow/actions/agent-run.test.ts:3143-3175` (re-resolve once, fresh dispatch, no stale `sessionId`, pin+marker persisted), `:3177-3193` (second disable fails loudly). Naming note: task token `pin-reresolved` is implemented as `pinReresolved`, consistent end-to-end — cosmetic, not a gap. |
| R2 | MET | `executor`, `sessionId`, `session: reused\|fresh` on every dispatched agent.run result: `agent-run.ts:1052-1058`; exposed in `spur workflow trace <run> --json`: `TRACE_RESULT_FIELDS` `packages/app/src/services/workflow-service.ts:2402-2412` → `projectActionTraceResult` copy loop `:2499-2504` → timeline event `result` field `:1531,1551` → CLI JSON envelope `apps/cli/src/commands/workflow.ts:1384-1387`; table renders k=v for all result fields `workflow.ts:1557-1620`. Tests: `agent-run.test.ts:3195-3219` (executor/sessionId/session=reused on resumed stage; fresh in `:3165-3166`), CLI render `apps/cli/tests/commands/workflow.test.ts:3039-3073`. Note: `sessionId` is omitted (not falsified) on a stage with no session id yet; resumed stages always carry the accepted id. |
| R3 | MET | Resumed pinned stage dispatches with `flags.sessionId = storedSessionId` (`agent-run.ts:472-477`) and joins on the workflow run id, never a minted one: `flags['run-id'] = context.runId` (`agent-run.ts:468-470`) → `agent-service.ts:1740`; supplied id skips watermark observation and writes the exact mapping: `agent-service.ts:1360-1362` → `run-session-observer.ts:136-140` (supply) and `:147-161` (resolve writes `exactness: 'exact', mechanism: 'supplied'` — no heuristic match); one observer per dispatch → one mapped row. Tests: `agent-run.test.ts:3195-3219` asserts `run-id`/`sessionId` join inputs; exact/supplied row shape is pre-existing covered behavior (`run-session-observer.test.ts:149-161`, `agent-service.test.ts:3371-3374`) — compose-check scope per brief. |
| R4 | MET | Mid-run disable path (re-resolve once + second-disable loud failure): `agent-run.test.ts:3143-3193`; trace fields: `:3143-3175`, `:3195-3219`, CLI `workflow.test.ts:3054-3073`; E6 mapping row inputs (run id + accepted session id): `:3195-3219` with the exact-row writer verified at `run-session-observer.ts:147-161`. Gate: `bun run spur-check` exit 0 (supervisor-supplied receipt: 8540 tests / 484 files) — not re-run by this reviewer (no shell tool); static inspection found no skipped/suppressed tests in scope. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:ea36e21c59ed6d23909de1bc057a87a6d1cf76bf2732018608762030c5eee93a |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T13:33:36.390Z todo → wip (system)
- 2026-09-18T14:02:48.864Z wip → testing (system)
- 2026-09-18T14:03:08.845Z testing → done (system)

