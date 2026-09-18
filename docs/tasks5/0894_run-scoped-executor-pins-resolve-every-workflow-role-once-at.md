---
schema_version: 1
name: "Run-scoped executor pins: resolve every workflow role once at precheck, keep per-role session slots, and apply the coder-reuse / reviewer-fresh stage session policy"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.555Z
updated_at: "2026-09-18T13:07:11.891Z"
feature_id: B7
priority: P1
tags:
  - workflow
  - agent-run
  - session
  - B7
estimate_hours: 8

dependencies: []
---

## 0894. Run-scoped executor pins: resolve every workflow role once at precheck, keep per-role session slots, and apply the coder-reuse / reviewer-fresh stage session policy

### Background

Every model-bearing stage resolves its executor and spawns a cold one-shot subprocess; `agent.run` is 96% of machine time (357 s avg). Authority: `docs/design/session-pinned-dispatch.md` §4 (resolve once, session pin per role, stage policy, capability gate), ADR-121, ADR-047 (affinity precedence). Current code: `agent-run.ts` reads `__agentSessionDir`/`__agentSessionId`, `freshSession`; `doctor.probe` runs per stage. Capabilities come from `getAgentSessionCapability` (task 2 widens it; this task reads whichever fields exist).

### Requirements

- [x] R1. `precheck` (task-pipeline) and `start` (idea-pipeline) resolve every role declared by the workflow's `agent.run` stages once and write `__executor.<role> = {{ name, agent, model, tier, capabilities }}` into run vars; `agent-run.ts` reads the pin and performs no doctor/detection call on the per-stage path (asserted by a test that fails on any doctor invocation after precheck).
- [x] R2. Session state moves to `__session.<role>.{{dir,id}}`; the post-run `discoverSessionId` write-back targets the role slot; ADR-047 precedence is preserved (an explicit pin never emits a global continue).
- [x] R3. `agent.run` accepts an optional `session: reuse | fresh` option; defaults by role are coder → `reuse`, reviewer/planner/scribe → `fresh`; `spur workflow validate` rejects any other value.
- [x] R4. A reviewer stage may declare `session: reuse` explicitly; the run trace records the declaration source (`default` | `declared`).
- [x] R5. When the pinned executor's `supportsResumeById` is `false`, every stage runs fresh and one warning `executor-no-resume` is emitted per run (not per stage).
- [x] R6. `config/workflows/task-pipeline.yaml` and `idea-pipeline.yaml` declare the intended policy per stage (coder stages reuse; review/verify fresh); `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/`.
- [x] R7. Tests in `packages/app/tests/workflow/` cover R1–R5 with a stubbed resolver; the workflows design satellite documents the `session` option; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B7 scenarios R1, R2, R3, R4, R5.

- [x] AC1 — Executor resolution happens once per role per run (req: R1)
- [x] AC2 — A coder-role stage resumes the previous coder-role session (req: R2)
- [x] AC3 — Reviewer-role stages never inherit the coder session by default (req: R3)
- [x] AC4 — A stage can override the session policy explicitly (req: R4)
- [x] AC5 — An executor without resume support degrades to fresh per stage (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: the run, not the stage, is the unit of dispatch (docs/design/session-pinned-dispatch.md §2, §4). Pins are run vars because run vars already survive pauses and resumes and are visible in `workflow trace`; a new store would duplicate that. Stage isolation becomes a declared policy: reviewers are fresh by default so review never inherits the implementer's context (operator confirmed 2026-09-17). Non-resume executors degrade to today's behaviour with one warning, so no agent is blocked by this change. Mutation policy: `packages/app/src/workflow/actions/agent-run.ts`, the precheck/start resolution seam (`doctor.probe` action + `resolveRole`), workflow schema for the `session` option + validate, the two bundled workflow YAMLs, tests, workflows satellite; no pin invalidation, no trace columns, no E6 mapping (task 8).

### Plan

1. Read design §4, ADR-047, `agent-run.ts` affinity block, the `doctor.probe` action, and `resolveRole` in `agent-service.ts`.
2. Implement role enumeration + one-time resolution at precheck/start; write `__executor.<role>` pins.
3. Move session slots to `__session.<role>`; add the `session` option with role defaults and validation; add the one-per-run warning.
4. Declare policies in both workflow YAMLs; rebuild the bundle.
5. Write the tests; update the workflows satellite; run `cd packages/app && bun test tests/workflow/` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/agent-service.ts:1754` |
| `packages/app/src/services/agent-service.ts:1926` |
| `packages/app/src/services/agent-service.ts:2145` |
| `packages/app/src/services/agent-service.ts:2195` |
| `packages/app/src/services/agent-service.ts:2212` |
| `packages/app/src/services/workflow-service.ts:1850` |
| `packages/app/src/workflow/actions/agent-run.ts:1022` |
| `packages/app/src/workflow/actions/agent-run.ts:1025` |
| `packages/app/src/workflow/actions/agent-run.ts:1029` |
| `packages/app/src/workflow/actions/agent-run.ts:19` |
| `packages/app/src/workflow/actions/agent-run.ts:235` |
| `packages/app/src/workflow/actions/agent-run.ts:256` |
| `packages/app/src/workflow/actions/agent-run.ts:270` |
| `packages/app/src/workflow/actions/agent-run.ts:289` |
| `packages/app/src/workflow/actions/agent-run.ts:294` |
| `packages/app/src/workflow/actions/agent-run.ts:300` |
| `packages/app/src/workflow/actions/agent-run.ts:324` |
| `packages/app/src/workflow/actions/agent-run.ts:355` |
| `packages/app/src/workflow/actions/agent-run.ts:412` |
| `packages/app/src/workflow/actions/agent-run.ts:465` |
| `packages/app/src/workflow/actions/agent-run.ts:510` |
| `packages/app/src/workflow/actions/agent-run.ts:57` |
| `packages/app/src/workflow/actions/agent-run.ts:945` |
| `packages/app/src/workflow/actions/agent-run.ts:992` |
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
| `plugins/sp/tests/task-pipeline-resilience.test.ts:109` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/doctor-probe.ts:126-129,201,241` (roles map → `setVars['__executor.<role>']` via injected agentService); `agent-run.ts:72` (parseExecutorPin), `:414` (pin → per-stage resolve skipped); registration wiring in `builtins.ts` (agentService threaded); `config/workflows/idea-pipeline.yaml:96-100` (start-stage roles); tests `session-pinned-dispatch.test.ts:475-516` (incl. `calls).toHaveLength(1)`), `agent-service.test.ts:1931-1942` (pinResolved=true skips doctor walk) |
| R2 | MET | `agent-run.ts` role slots; `packages/app/tests/workflow/actions/agent-run.test.ts:2035-2045` (role slots → resume flags; legacy `__agentSessionDir` absent), `:2313-2314` (discovery writes `__session.coder.id`); `session-pinned-dispatch.test.ts:194-195,207-213` (reuse reads role slot), `:196-197` (ADR-047 no global continue) |
| R3 | MET | PASS |
| R4 | MET | `agent-run.ts:244` (`sessionSource: declared\|default`); declaration-source test coverage in `session-pinned-dispatch.test.ts`; design decision recorded `docs/design/session-pinned-dispatch.md:148` |
| R5 | MET | `agent-run.ts` latch (`noResumeNotYetWarned` + `__executorNoResumeWarned` + `workflow.executor-no-resume` event); `agent-run.test.ts:2894-2955` (no resume flag, `session: 'fresh'`, role-slot vars) + once-per-run assertions |
| R6 | MET | `config/workflows/task-pipeline.yaml:231-233,374-376,439-442,502-505`; `config/workflows/idea-pipeline.yaml:97-100,128-131`; regenerated `apps/cli/config/workflows/*` verified identical (see above) |
| R7 | MET | `session-pinned-dispatch.test.ts:475-516` (stubbed agentService; 0894 R1 wiring describe), `agent-run.test.ts` 0894-tagged R2/R3 tests, `agent-service.test.ts:1931-1942` seam test; `docs/design/session-pinned-dispatch.md:79` (option + role defaults), `:82` (trace `session: reused\|fresh`); gate: parent-run `bun run spur-check` exit 0, 8536 tests / 484 files (report-only — not rerun here) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:54ef84a52e11a93563cfef7678189587a0df0c42efdac6b78d9129953a685ae0 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T11:43:50.797Z todo → wip (system)
- 2026-09-18T13:06:17.638Z wip → testing (system)
- 2026-09-18T13:07:11.891Z testing → done (system)

