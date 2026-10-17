---
schema_version: 1
name: Executor-agnostic agent.run dispatch with host pause and durable receipt
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.817Z
updated_at: "2026-10-17T17:18:19.882Z"
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

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/host-executor.ts:32` (`withHostExecutorPause`) + `packages/app/src/services/workflow-run-ops.ts:142` transform the definition only when `vars.executor: host`, and `packages/app/src/workflow/actions/agent-run.ts:832` dispatches the host surface; the work item (§4.1 shape) is written by `executeHostSurface` (`packages/app/src/workflow/actions/agent-run.ts:467`) and surfaced as the pause payload by `attachHostPause` (`packages/app/src/workflow/host-executor.ts:85`). Tests: `packages/app/tests/workflow/host-executor.test.ts:141` and `packages/app/tests/services/workflow-host-executor.test.ts:138` |
| R2 | MET | `packages/app/src/services/workflow-resume-ops.ts:255` (`resolveHostPauseReceipt`), called at `:154` validates run id, state, `outcome === 'done'`, every `expectFiles` path and the declared `ownedSections` in `packages/app/src/workflow/receipt.ts:185` **before** the resume claim and before the drift/stale metadata writes; the canonical receipt is persisted at `packages/app/src/services/workflow-resume-ops.ts:210`. Refusal and no-side-effect assertions: `packages/app/tests/services/workflow-host-executor.test.ts:223,236,251,264,280` |
| R3 | MET | One `WorkItemReceipt` shape written by both non-host surfaces through `recordReceipt` (`packages/app/src/workflow/actions/agent-run.ts:528`): subprocess at `packages/app/src/workflow/actions/agent-run.ts:574` onward, fleet at its own executor branch in the same method; the A4 mapping (`done`/`failed`/`not-started`/`outcome-unknown`/`contract-violation`) is unit-tested in `packages/app/tests/workflow/actions/agent-run-receipt.test.ts` (11 cases incl. the fleet timeout → `outcome-unknown` and the contract-violation branch) |
| R4 | MET | Executor selection is `selectsHostExecutor(context.vars)` beside the fleet branch (`packages/app/src/workflow/actions/agent-run.ts:832`); no CLI verb, flag or workflow-schema change — the four work-item keys are optional `agent.run` options folded from the existing `expectFile` (`declaredExpectFiles`, `packages/app/src/workflow/actions/agent-run.ts:1652`). Unset/fleet paths proven unchanged by `packages/app/tests/services/workflow-host-executor.test.ts:165,175`; `spur task check 1232` PASS with the composition lint clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 — The host executor pauses the run with a work item at an agent.run stage (req: R1, R2) | MET | command | `packages/app/tests/services/workflow-host-executor.test.ts:138` (host run pauses and returns the §4.1 work item) and `packages/app/tests/services/workflow-host-executor.test.ts:280` (second continue refused as not resumable, no side effects); running those four new `packages/app/tests/**` test files inside the app workspace → 45 pass, 0 fail |
| AC2 — R2 — Subprocess and fleet executors complete the same work item on a durable receipt (req: R3) | MET | command | `packages/app/tests/workflow/actions/agent-run-receipt.test.ts` — subprocess and fleet write the same shape, fleet timeout records `outcome-unknown` never failed, definite `not-started` recorded as such; `packages/app/src/workflow/receipt.ts:118` is the single writer |
| AC3 — R15 — New commands keep the noun verb shape (req: R4) | MET | command | `bun run lint` exit 0 (biome 1573 files + 8 workspace typechecks, `packages/app` typecheck included); `spur task gate 1232 run` → `quality gate PASS` (log `.spur/run/1232-test-gate.log`); `git status --porcelain` lists only `packages/app/src/**` + `packages/app/tests/**` — no `apps/cli/src/commands` change, so no new verb or nested group exists |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T17:17:32.455Z todo → wip (system)
- 2026-10-17T17:17:33.058Z wip → testing (system)
- 2026-10-17T17:18:19.876Z testing → done (system)

