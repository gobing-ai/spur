---
schema_version: 1
name: Executor-agnostic agent.run dispatch with host pause and durable receipt
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.817Z
updated_at: "2026-10-18T02:01:58.181Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - fleet
estimate_hours: 8

dependencies: ["1231"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1232-verdict.json
---

## 1232. Executor-agnostic agent.run dispatch with host pause and durable receipt

### Background

Feature D65 F1/F2. Today the host LLM interprets the YAML (ADR-047 amendments, ADR-087), costing 32% driver overhead across 32 measured runs. The engine must execute every surface and hand an agent.run to a host, subprocess or fleet executor through one work item and one receipt.

**Refine corrections (2026-10-17)**
- R4 "host resolution uses the host-session pin (ADR-121/132)" → hostSessionId() is Claude-only (CLAUDE_CODE_SESSION_ID, apps/cli/src/commands/agent/shared.ts:152) → resolve host by `context.vars.executor === 'host'` beside the `'fleet'` branch (agent-run.ts:687); driver skills pass `--vars '{"executor":"host"}'`. No new flag.
- Design premise "--answer-text accepted on non-input pauses" → continue.ts:100 targets input gates only → the host pause is an input-kind pause so --answer-text carries the receipt path.
- `workflow run` has no --agent flag (flags: --vars, --run-id, --async, --json) → executor is a var, consistent with above.

### Requirements

- [x] R1. When an agent.run runs with `vars.executor: host`, the engine pauses the run as an input-kind pause and `spur workflow run|continue --json` returns the work item as the pause payload.
- [x] R2. `spur workflow continue <run-id> --answer-text <receipt-path>` validates the receipt (expectFiles present, owned sections written) and resumes; a second continue on a non-paused run is refused without side effects.
- [x] R3. Subprocess (`AgentRunActionRunner`) and fleet (`fleet-dispatch.ts` dispatchToFleet :138) executors write the same receipt shape; ADR-126 A4 rules apply to all three.
- [x] R4. Executor selection is `vars.executor` (host | fleet | unset → existing tier resolution, agent-run.ts:444); headless callers keep ADR-087 substitution. No new verb or flag unless the operator consents at review.

### Acceptance Criteria

- [x] AC1 — R1 — The host executor pauses the run with a work item at an agent.run stage (req: R1, R2)
- [x] AC2 — R2 — Subprocess and fleet executors complete the same work item on a durable receipt (req: R3)
- [x] AC3 — R15 — New commands keep the noun verb shape (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:22.659Z

- Host selection via `vars.executor: host` (closed, refine 2026-10-17): agent-neutral, reuses the existing fleet branch pattern, needs no flag.
- Pause kind: input-kind, because --answer-text is input-only (closed).

### Design

Add a `host` branch next to the `fleet` branch at agent-run.ts:687: it writes the work item, then raises the engine's existing input-kind HITL pause (same persistence, `run --json` surfacing and CAS claim the hitl `input` action already uses). Resume reuses `--answer-text` (input-only, continue.ts:100), whose value is the receipt path; the runner validates the receipt before releasing the transition. The receipt is a file path so host, subprocess and fleet differ only in who writes it. Agent-neutral: no CLAUDE_CODE_SESSION_ID dependency. Rejected: session-pin resolution (Claude-only), subprocess-everything (loses host context and native subagents), host-only (breaks fleet), a new run state (the pause already exists).

### Plan

- [x] Write failure modes first: missing receipt, partial expectFiles, double continue, stale run, fleet timeout, executor var unset
- [x] `host` branch at agent-run.ts:832 raising an input-kind pause with the work item
- [x] Receipt validation on continue
- [x] Unify subprocess/fleet receipt shape
- [x] Service-level executor surface coverage (the live host × subprocess × fleet matrix is task 1238's fixture E2E)

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/workflow-resume-ops.ts:12` |
| `packages/app/src/services/workflow-resume-ops.ts:14` |
| `packages/app/src/services/workflow-resume-ops.ts:150` |
| `packages/app/src/services/workflow-resume-ops.ts:200` |
| `packages/app/src/services/workflow-resume-ops.ts:207` |
| `packages/app/src/services/workflow-resume-ops.ts:237` |
| `packages/app/src/services/workflow-resume-ops.ts:244` |
| `packages/app/src/services/workflow-resume-ops.ts:3` |
| `packages/app/src/services/workflow-run-ops.ts:138` |
| `packages/app/src/services/workflow-run-ops.ts:184` |
| `packages/app/src/services/workflow-run-ops.ts:3` |
| `packages/app/src/services/workflow-run-ops.ts:5` |
| `packages/app/src/services/workflow-service.ts:17` |
| `packages/app/src/services/workflow-service.ts:58` |
| `packages/app/src/workflow/actions/agent-run.ts:1651` |
| `packages/app/src/workflow/actions/agent-run.ts:183` |
| `packages/app/src/workflow/actions/agent-run.ts:34` |
| `packages/app/src/workflow/actions/agent-run.ts:36` |
| `packages/app/src/workflow/actions/agent-run.ts:459` |
| `packages/app/src/workflow/actions/agent-run.ts:516` |
| `packages/app/src/workflow/actions/agent-run.ts:829` |
| `packages/app/src/workflow/host-executor.ts:1` |
| `packages/app/src/workflow/receipt.ts:1` |
| `packages/app/tests/services/workflow-host-executor.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run-receipt.test.ts:1` |
| `packages/app/tests/workflow/host-executor.test.ts:1` |
| `packages/app/tests/workflow/receipt.test.ts:1` |

Follow-up verification fixes: packages/app/src/workflow/actions/agent-run.ts:559 returns an action pause; the pinned shared-engine patch persists the action cursor before downstream consumers. packages/app/src/services/workflow-resume-ops.ts:270 distinguishes host receipt pauses from later approval gates. packages/app/src/workflow/fleet-work-item.ts:76 applies the same member-side contract before linked completion; matching role selectors preserve the configured fleet executor. docs/reports/d65-real-task-executor-receipt.json:1 records actual task-pipeline action and receipt parity across all three surfaces.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests/services/workflow-host-executor.test.ts:102 and .spur/run/d65-verifyall/fleet-host-integrated.log — same-state consumers wait for the host receipt and resume once; patched shared-engine regression suite passes |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 180 — (pass) host pause resume (D65 1232 R2) > a done receipt advances the run to the next host stage, then to done [19.46ms]; fresh targeted run exited 0 |
| R3 | MET | docs/reports/d65-real-task-executor-receipt.json:1 — full real task pipeline finishes on all three dispatch surfaces with matching action and receipt projections; fleet-work-item tests enforce member-side answer and diff contracts |
| R4 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 97 — (pass) selectsHostExecutor > true only when the run var says host [0.02ms]; fresh targeted run exited 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The host executor pauses the run with a work item at an agent.run stage | MET | test | packages/app/tests/services/workflow-host-executor.test.ts:102 and .spur/run/d65-verifyall/fleet-host-integrated.log — same-state consumers wait for the host receipt and resume once; patched shared-engine regression suite passes; @run `.spur/run/d65-verifyall/app-tests.log` line 180 — (pass) host pause resume (D65 1232 R2) > a done receipt advances the run to the next host stage, then to done [19.46ms]; fresh targeted run exited 0 |
| R2 — Subprocess and fleet executors complete the same work item on a durable receipt | MET | test | docs/reports/d65-real-task-executor-receipt.json:1 — full real task pipeline finishes on all three dispatch surfaces with matching action and receipt projections; fleet-work-item tests enforce member-side answer and diff contracts |
| R15 — New commands keep the noun verb shape | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 97 — (pass) selectsHostExecutor > true only when the run var says host [0.02ms]; fresh targeted run exited 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | packages/app/tests/services/workflow-host-executor.test.ts:102 and .spur/run/d65-verifyall/fleet-host-integrated.log — same-state consumers wait for the host receipt and resume once; patched shared-engine regression suite passes |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 180 — (pass) host pause resume (D65 1232 R2) > a done receipt advances the run to the next host stage, then to done [19.46ms]; fresh targeted run exited 0 |
| R3 | MET | docs/reports/d65-real-task-executor-receipt.json:1 — full real task pipeline finishes on all three dispatch surfaces with matching action and receipt projections; fleet-work-item tests enforce member-side answer and diff contracts |
| R4 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 97 — (pass) selectsHostExecutor > true only when the run var says host [0.02ms]; fresh targeted run exited 0 |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — The host executor pauses the run with a work item at an agent.run stage | MET | test | packages/app/tests/services/workflow-host-executor.test.ts:102 and .spur/run/d65-verifyall/fleet-host-integrated.log — same-state consumers wait for the host receipt and resume once; patched shared-engine regression suite passes; @run `.spur/run/d65-verifyall/app-tests.log` line 180 — (pass) host pause resume (D65 1232 R2) > a done receipt advances the run to the next host stage, then to done [19.46ms]; fresh targeted run exited 0 |
| R2 — Subprocess and fleet executors complete the same work item on a durable receipt | MET | test | docs/reports/d65-real-task-executor-receipt.json:1 — full real task pipeline finishes on all three dispatch surfaces with matching action and receipt projections; fleet-work-item tests enforce member-side answer and diff contracts |
| R15 — New commands keep the noun verb shape | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 97 — (pass) selectsHostExecutor > true only when the run var says host [0.02ms]; fresh targeted run exited 0 |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T17:17:32.455Z todo → wip (system)
- 2026-10-17T17:17:33.058Z wip → testing (system)
- 2026-10-17T17:18:19.876Z testing → done (system)

