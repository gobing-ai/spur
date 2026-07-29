---
template: feature-impl
schema_version: 1
name: "Bridge CLI-process workflow and agent events into the ledger via the task-0249 direct-DAO pattern"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P0
tags: ["observability", "cli-bridge", "data-plane"]
dependencies: ["0367", "0369"]
created_at: "2026-07-29T00:14:03.018Z"
updated_at: "2026-07-29T04:50:51.734Z"
---

## 0370. Bridge CLI-process workflow and agent events into the ledger via the task-0249 direct-DAO pattern

### Background

The ledger holds zero `workflow.*` and zero `agent.*` rows — ever — while the same database holds 390 rows in `runs` and 501 in `action_runs`. The work happened; the events did not survive. Cause is Gap 4 in docs/inventory/system-events-producer-audit.md: workflow and agent execution runs in the CLI process, whose EventBus is process-local and never reaches the server tap. Task 0249 already solved this exact problem for `task.*` and `feature.*` by having the CLI write through `SystemEventEmitter` to `SystemEventDao` directly (audit table rows 1-6, emit sites task.ts:612 and feature.ts:366). This task extends that proven path to the workflow and agent families, which is what finally makes task 0365's entire observability investment visible on the Board. Operator decision on 2026-07-28 selected this over server-side ingestion of the .spur/runs/workflow/*.jsonl traces; those traces remain the CLI-side replay artifact.

### Requirements
- [x] R1. Route cataloged `workflow.*` and `agent.*` events emitted in the CLI process through the `SystemEventEmitter` → `SystemEventDao` path, mirroring the task-0249 wiring.
- [x] R2. Preserve 0365 redaction and payload bounds ahead of every write; no raw prompt, command, environment value, or output chunk reaches the ledger.
- [x] R3. Persist the envelope's correlation fields so a CLI-driven run is joinable to its `runs` row by run id.
- [x] R4. Emit exactly one lifecycle series per agent execution — a workflow-dispatched `agent.run` must not double-count against the direct `spur agent run` path (the 0365 R9 invariant).
- [x] R5. A ledger write failure must be logged and swallowed; a workflow run must never fail because observability persistence failed.
- [x] R6. Respect the tier decisions from the catalog task — diagnostic-tier lifecycle members stay out of the ledger unless the toggle is on.
- [x] R7. Update the producer audit table's status column for the newly-reachable entries and narrow the Gap 4 note to the residual child-of-child case.
### Acceptance Criteria
```gherkin
Scenario: R12 — A CLI-driven workflow run becomes visible on the data plane
Scenario: R13 — Agent lifecycle from a CLI run is correlated, not double-counted
Scenario: R14 — A ledger write failure never breaks the CLI run
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Mirror task 0249's direct-DAO durability for EventBus producers:
- Planning used `SystemEventEmitter` because mutations call `EventEmitter.emit(PlanningEvent)` with no bus.
- Workflow/agent already emit on a process-local `EventBus`, so the dual is `registerSystemEventTap` → `SystemEventDao` (same normalize / actor / correlation / R5 isolation as the server tap and the planning emitter).

**CLI attach point.** `apps/cli/src/system-event-ledger.ts` exports `attachSystemEventLedger(bus, context)` — opens the shared SQLite ledger, registers the catalog tap (diagnostic tier only when toggled), returns `{ flush, unsubscribe }` with failure isolation on attach.

**Wiring.**
- `spur workflow run` / `continue`: always construct a local `EventBus` (not only for human progress / `--trace-file` / `--steer`); pass it as both `observabilityBus` and `events` to `WorkflowAppService`; attach the ledger and flush in `finally`.
- `spur agent run`: `context.agentService({ events: bus })` with the same attach. Workflow path intentionally leaves `AgentService.events` unset so a workflow-dispatched `agent.run` emits only the `workflow.agent` series (0365 R9 / R4 no double-count).
- `continuePaused` now forwards the engine `events` bus the same way `run()` does.

**Out of scope.** CLI `rule.*` / `message.*` / supervisor `process.*`; child-of-child IPC; server-side JSONL ingestion (operator declined).
### Plan
1. Add `attachSystemEventLedger` helper (`apps/cli/src/system-event-ledger.ts`).
2. Wire workflow run/continue + agent run to the ledger bus.
3. Extend `CliContext.agentService(opts?)` for optional events while preserving agentConfig.
4. Tests: unit (attach fail / correlation / diagnostic / persist fail) + integration (workflow run → ledger rows).
5. Update producer audit (R7): workflow/agent CLI reachable; Gap 4 narrowed to child-of-child.
6. Write Solution change-map.
### Solution
| File | Change |
| --- | --- |
| `apps/cli/src/system-event-ledger.ts:41` | **New.** `attachSystemEventLedger` — CLI EventBus → `registerSystemEventTap` → `SystemEventDao`; attach failures log+swallow (R5); diagnostic toggle (R6). |
| `apps/cli/src/commands/workflow.ts:259` | `run`: always build a local bus; wire both `observabilityBus` + `events`; attach ledger; flush/unsubscribe in `finally`. Leave workflow's `agentService()` without events (R4). |
| `apps/cli/src/commands/workflow.ts:374` | `continue`: same ledger attach + bus wiring as `run`. |
| `apps/cli/src/commands/agent.ts:299` | `runAgentRun` attaches ledger + `context.agentService({ events: bus })` for cataloged `agent.invoke.*`. |
| `apps/cli/src/context.ts:35` | `agentService(options?)` accepts optional `events`/`processRegistry`; expose `agentConfig` on context. |
| `packages/app/src/services/workflow-service.ts:537` | `continuePaused` forwards engine `events` bus like `run()` (0370 parity). |
| `apps/cli/tests/system-event-ledger.test.ts:34` | Unit: attach fail, non-Error fail, correlation `run_id`, diagnostic skip, persist fail (R5). |
| `apps/cli/tests/commands/workflow-system-events.test.ts:61` | Integration: `spur workflow run` → `workflow.*` rows with `run_id`; silent path; validate is read-only. |
| `docs/inventory/system-events-producer-audit.md` | R7: workflow/agent CLI ✅; Gap 1 partially closed; Gap 4 narrowed to child-of-child residual. |

The Board never saw CLI-driven workflow/agent events because the server tap is process-local to `spur serve`. Reusing the proven 0249 direct-DAO path via the EventBus tap dual makes CLI runs visible without server-side JSONL ingestion, preserves 0365 redaction/normalization, correlates by `runId`, and isolates sink failures so observability never breaks a run.
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/system-event-ledger.ts:42-88`; workflow/agent attach sites |
| R2 | MET | `apps/cli/src/system-event-ledger.ts:68`; `apps/cli/tests/system-event-ledger.test.ts:103-132` |
| R3 | MET | `apps/cli/tests/system-event-ledger.test.ts:65-91,152-177`; `apps/cli/tests/commands/workflow-system-events.test.ts:62-88` |
| R4 | MET | `apps/cli/src/commands/workflow.ts:94-100`; static command confirms no workflow `AgentService.events` bus |
| R5 | MET | `apps/cli/src/system-event-ledger.ts:64-75`; `apps/cli/tests/system-event-ledger.test.ts:35-63,180-209` |
| R6 | MET | `apps/cli/tests/system-event-ledger.test.ts:94-149` |
| R7 | MET | `docs/inventory/system-events-producer-audit.md:139-144,183` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R12 — A CLI-driven workflow run becomes visible on the data plane | MET | test | `apps/cli/tests/commands/workflow-system-events.test.ts:62-88` |
| R13 — Agent lifecycle from a CLI run is correlated, not double-counted | MET | command | source invariant command exit 0 plus `apps/cli/tests/system-event-ledger.test.ts:65-177` |
| R14 — A ledger write failure never breaks the CLI run | MET | test | `apps/cli/tests/system-event-ledger.test.ts:35-63,180-209` |

**Fresh commands**

- `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.
- `rg -n "agentService: \\(\\) => context.agentService\\(\\)" apps/cli/src/commands/workflow.ts` → exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major; sink isolation, configured-secret propagation, and single-series wiring are intact.

**Fix-pass disclosure:** `.spur/run/0370-verdict.json:1-74` regenerated; prior UNKNOWN Testing evidence was replaced with complete traceability.
### Review
**Review date:** 2026-07-28
**Mode:** `/sp-dev-review` + `/sp-dev-verify --fix all` (P1–P4 table required for L3)

| Pri | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P1 | (none) | No blockers — all R1–R7 MET; AC R12–R14 MET with executable evidence | None |
| P2 | (none) | No major SECUA or design-conformance gaps | None |
| P3 | apps/cli/src/commands/workflow.ts:259,374 | `bus as unknown as SystemEventBus` double-cast at ledger attach; CLI never plumbs `diagnosticEnabled` from config (always hard-off) | Align bus types in spur-app; optional config parity with serve.ts diagnostic toggle |
| P4 | apps/cli/src/commands/workflow.ts:363-413 | No E2E for continue HITL ledger path; R13 dual-count absence is static+unit | Accept for scope; continue shares unit-tested attach helper |

**Residual risk:** Gap 4 child-of-child residual (documented OOS). CLI diagnostic config not plumbed (P3).

**Disposition:** APPROVE — functional + SECUA PASS; architecture advisory only.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T03:19:51.152Z todo → wip (system)
- 2026-07-29T03:26:39.916Z wip → testing (system)
- 2026-07-29T03:33:28.902Z testing → done (system)
