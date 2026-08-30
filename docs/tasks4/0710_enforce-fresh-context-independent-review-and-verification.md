---
schema_version: 1
name: "Enforce fresh-context independent review and verification"
status: done
template: issue
created_at: 2026-08-28T23:03:05.708Z
updated_at: "2026-08-30T03:22:04.149Z"
priority: P1
tags: ["harness", "agent", "review", "verification"]
dependencies: ["0706"]
feature_id: A6
ac_altitude: task-local
---

## 0710. Enforce fresh-context independent review and verification

### Background

The task pipeline declares reviewer roles for review and verification but also pins both stages to `${vars.agent}`. `AgentRunActionRunner` carries workflow session affinity through `__agentSession` and a target-agent session directory, so a reviewer can resume the implementer's conversational context when the resolved target is the same. A new execution id alone does not guarantee an independent context or executor.

This task makes independence an enforced routing/session property. It reuses the existing role/executor model and adds only the action-level controls required to prove fresh context and, for material risk, a distinct executor.

### Requirements

- [x] R1. Add an `agent.run` fresh-session option that bypasses inherited workflow session id and session directory for that action without disturbing unrelated session-affinity behavior.
- [x] R2. Configure built-in review and final verification stages to always use fresh context; implementation context may be summarized only through persisted task/diff/artifact inputs.
- [x] R3. Record resolved executor/spec/model/session provenance for implement, review, and verify in bounded run evidence.
- [x] R4. Add a risk policy using existing task priority: P0/P1 work requires review/verify to resolve a different executor spec from implementation; lower priorities require fresh context but may reuse the executor when no alternative exists.
- [x] R5. Evaluate distinctness after routing and before dispatch. A required-distinct stage with no eligible executor fails closed and names the missing role/capability configuration.
- [x] R6. Review and verification remain separate executions; neither may inherit the other's session.
- [x] R7. Reuse the existing reviewer role, executor registry, and routing attribution. Do not create a second agent framework or new role vocabulary.
- [x] R8. Extend composition tests so pinning review/verify to the implementation session or omitting fresh-session enforcement fails.

Non-goals: consensus voting, multiple reviewers by default, remote identity proof, or forcing distinct providers for low-risk tasks.

### Acceptance Criteria

```gherkin
Feature: Independent review and verification

  Scenario: Reviewer starts without implementation context
    Given implementation completed with a resumable agent session
    When task-pipeline enters review
    Then review dispatch receives no inherited implementation session id or session directory
    And it reads only persisted task, diff, and artifact inputs

  Scenario: Material task requires a distinct executor
    Given a P1 task was implemented by executor spec A
    And reviewer role can resolve executor spec B
    When review and verification dispatch
    Then each uses fresh context and neither resolves to A
    And bounded routing evidence identifies the separation

  Scenario: Missing independent reviewer fails closed
    Given a P0 task and only the implementation executor is eligible for reviewer role
    When review routing is evaluated
    Then no review subprocess starts
    And the failure names the distinct-executor requirement and configuration remedy

  Scenario: Low-risk task still gets fresh context
    Given a P3 task and one eligible executor
    When review runs
    Then the executor may be reused but the implementation session is not
```

### Q&A

**Q: Must every task use a different provider/model?** No. Fresh context is universal. A distinct configured executor
spec is required only for P0/P1 material work; provider diversity is not itself the invariant.

**Q: Can a summary of implementation context be passed?** Only through persisted task, diff, verdict, or bounded artifact
inputs visible to any reviewer. Hidden conversational state is what must not cross the boundary.

**Q: Why use priority as risk?** Task priority already exists and avoids adding a second risk taxonomy for this first
policy. If evidence later shows priority is insufficient, evolve it in a separate task.

**Q: What if only one executor is configured?** P0/P1 fails before review with a precise configuration requirement.
P2-P4 may reuse the executor but still start a fresh session.

### Design

Extend `agent.run` with `freshSession: true` and a small independence requirement referencing a prior action's recorded routing identity. The runner already creates execution ids and records routing attribution; persist only the minimum prior-action identity needed for comparison.

Task-pipeline review and verify remove inherited session reuse and resolve through the existing reviewer role. For P0/P1, compare the selected executor spec against implementation and fail before spawn if equal or absent. For P2-P4, fresh context is mandatory while executor reuse is allowed. Review and verify each start fresh; they may consume the same immutable proof inputs and bounded evidence artifacts.

Do not add a public CLI flag unless an existing surface cannot express workflow vars; prefer internal workflow/action options and current config roles.

### Plan

1. Add failing tests demonstrating session id/directory reuse across implement, review, and verify.
2. Implement `freshSession` at the shared action-runner session-resolution seam.
3. Persist bounded action routing identity for later independence checks.
4. Add a pure priority-to-independence policy and distinct-executor comparison.
5. Update task-pipeline review/verify actions to resolve reviewer role with fresh sessions.
6. Gate P0/P1 dispatch on distinct executor availability; preserve lower-priority fallback.
7. Include routing/session provenance in review/verdict evidence without leaking prompts.
8. Extend composition-baseline and action/service tests.
9. Synchronize workflow, agent-routing, and verification design docs.
10. Run targeted tests, `bun run spur-check`, and task-pipeline definition checks.

### Root Cause

`config/workflows/task-pipeline.yaml` pins implementation, review, and verify to `${vars.agent}` while only annotating the
latter two with `role: reviewer`. In `packages/app/src/workflow/actions/agent-run.ts`, successful dispatch stores a
workflow-scoped `__agentSession` and selects a session directory by target agent. A later action resolving the same target
can continue that session. The separately generated execution id proves a new process invocation, not fresh context or
independent routing.

The defect is therefore stronger than a role-label mismatch: session affinity and explicit agent pinning override the
intended reviewer separation. No policy compares resolved implementation and reviewer executor identities before spawn.

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:778` |
| `apps/cli/src/commands/workflow.ts:781` |
| `apps/cli/src/commands/workflow.ts:812` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:11` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:138` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:14` |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:45` |
| `apps/cli/tests/init-templates.test.ts:376` |
| `packages/app/src/observability/agent-execution.ts:153` |
| `packages/app/src/observability/agent-execution.ts:24` |
| `packages/app/src/observability/agent-execution.ts:256` |
| `packages/app/src/observability/agent-execution.ts:3` |
| `packages/app/src/observability/agent-execution.ts:52` |
| `packages/app/src/observability/agent-execution.ts:99` |
| `packages/app/src/observability/workflow-run-log-sink.ts:176` |
| `packages/app/src/observability/workflow-run-log-sink.ts:226` |
| `packages/app/src/observability/workflow-run-log-sink.ts:4` |
| `packages/app/src/observability/workflow-run-log-sink.ts:87` |
| `packages/app/src/services/agent-service.ts:1102` |
| `packages/app/src/services/agent-service.ts:1393` |
| `packages/app/src/services/agent-service.ts:265` |
| `packages/app/src/services/agent-service.ts:49` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/services/agent-service.ts:812` |
| `packages/app/src/services/agent-service.ts:984` |
| `packages/app/src/services/done-transition-guard.ts:16` |
| `packages/app/src/services/review-independence.ts:1` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:297` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:47` |
| `packages/app/src/services/workflow-service.ts:848` |
| `packages/app/src/workflow/actions/agent-run.ts:16` |
| `packages/app/src/workflow/actions/agent-run.ts:172` |
| `packages/app/src/workflow/actions/agent-run.ts:185` |
| `packages/app/src/workflow/actions/agent-run.ts:187` |
| `packages/app/src/workflow/actions/agent-run.ts:200` |
| `packages/app/src/workflow/actions/agent-run.ts:218` |
| `packages/app/src/workflow/actions/agent-run.ts:23` |
| `packages/app/src/workflow/actions/agent-run.ts:284` |
| `packages/app/src/workflow/actions/agent-run.ts:417` |
| `packages/app/src/workflow/actions/agent-run.ts:474` |
| `packages/app/src/workflow/actions/agent-run.ts:499` |
| `packages/app/src/workflow/actions/agent-run.ts:515` |
| `packages/app/src/workflow/actions/agent-run.ts:598` |
| `packages/app/src/workflow/actions/agent-run.ts:609` |
| `packages/app/src/workflow/actions/agent-run.ts:614` |
| `packages/app/src/workflow/actions/agent-run.ts:682` |
| `packages/app/src/workflow/actions/agent-run.ts:687` |
| `packages/app/src/workflow/actions/agent-run.ts:8` |
| `packages/app/src/workflow/actions/agent-run.ts:94` |
| `packages/app/src/workflow/observability.ts:112` |
| `packages/app/src/workflow/observability.ts:114` |
| `packages/app/src/workflow/observability.ts:175` |
| `packages/app/src/workflow/observability.ts:262` |
| `packages/app/src/workflow/observability.ts:288` |
| `packages/app/src/workflow/observability.ts:312` |
| `packages/app/src/workflow/observability.ts:320` |
| `packages/app/src/workflow/observability.ts:55` |
| `packages/app/src/workflow/step-reporter.ts:103` |
| `packages/app/src/workflow/step-reporter.ts:115` |
| `packages/app/src/workflow/step-reporter.ts:18` |
| `packages/app/src/workflow/step-reporter.ts:23` |
| `packages/app/src/workflow/step-reporter.ts:274` |
| `packages/app/tests/observability/agent-execution.test.ts:40` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:327` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:66` |
| `packages/app/tests/services/agent-service.test.ts:3884` |
| `packages/app/tests/services/agent-service.test.ts:5` |
| `packages/app/tests/services/event-names.test.ts:306` |
| `packages/app/tests/services/event-names.test.ts:323` |
| `packages/app/tests/services/review-independence.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1714` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2290` |
| `packages/app/tests/workflow/observability.test.ts:328` |
| `packages/app/tests/workflow/step-reporter.test.ts:188` |
| `packages/app/tests/workflow/step-reporter.test.ts:198` |
| `packages/app/tests/workflow/step-reporter.test.ts:212` |
| `packages/app/tests/workflow/step-reporter.test.ts:215` |
| `packages/app/tests/workflow/step-reporter.test.ts:280` |
| `packages/app/tests/workflow/step-reporter.test.ts:45` |
| `packages/app/tests/workflow/step-reporter.test.ts:72` |
| `packages/config/src/index.ts:209` |
| `packages/config/src/index.ts:307` |
| `packages/domain/src/dao/run-dao.ts:145` |
| `plugins/sp/hooks/context-hooks.test.ts:630` |
| `plugins/sp/hooks/context-post-tool.ts:2` |
| `plugins/sp/hooks/context-post-tool.ts:23` |
| `plugins/sp/hooks/context-post-tool.ts:287` |
| `plugins/sp/hooks/context-post-tool.ts:323` |
| `plugins/sp/hooks/context-session-start.ts:15` |
| `plugins/sp/hooks/context-session-start.ts:166` |
| `plugins/sp/hooks/context-session-start.ts:17` |
| `plugins/sp/hooks/context-session-start.ts:19` |
| `plugins/sp/hooks/context-session-start.ts:2` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1422` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1455` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1487` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1496` |
| `plugins/sp/scripts/stage-registry-adapter.ts:207` |
| `plugins/sp/scripts/stage-registry-adapter.ts:27` |
| `plugins/sp/scripts/stage-registry-adapter.ts:999` |
| `plugins/sp/tests/cli-surface-parity.test.ts:10` |
| `plugins/sp/tests/cli-surface-parity.test.ts:239` |
| `plugins/sp/tests/cli-surface-parity.test.ts:241` |
| `plugins/sp/tests/cli-surface-parity.test.ts:423` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:230` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:172-227` — `freshSession === true` never reads `__agentSessionDir`/`__agentSessionId`, dispatches into per-node dir `fresh-<stateOrNodeId>` (`:206-214`), skips the session latch (`:226-227`); on success publishes only routing evidence, never session vars (`:609-618`). Test: `packages/app/tests/workflow/actions/agent-run.test.ts:2448` "R1: freshSession bypasses inherited session id/dir and the latch" — pass |
| R2 | MET | `config/workflows/task-pipeline.yaml:500,551` — review and verify declare `freshSession: true`; role `reviewer` at `:499,550` with no executor pin (live-YAML pin `not.toHaveProperty('agent')`, `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:136`); reviewer inputs are persisted paths only (taskFile, answerFile, diff/artifacts). `config/workflows/docs-pipeline.yaml:163` — verify hop `freshSession: true` (0710 R2 comment at `:162`) |
| R3 | MET | `packages/app/src/workflow/actions/agent-run.ts:626-630` — every successful dispatch persists `__agentRouting_<node>` = `{"agent", "model?"}` (identifiers only, no prompts/output); parser `packages/app/src/services/review-independence.ts:31-49` treats missing/malformed as unknown, never permissive; docs `docs/04_DESIGN.md:2278-2285` |
| R4 | MET | `packages/app/src/services/review-independence.ts:24-29` — `requiresDistinctExecutor` returns true exactly for P0/P1; priority source: `config/workflows/task-pipeline.yaml:328-331` quality-gate shell seds the TASK FILE (via `cat .spur/run/$wbs-taskpath.txt`) and upper-normalizes into `vars.taskPriority` (`:96-99,336-340`); review/verify pass `priority: ${vars.taskPriority}` (`:501,552`). Executable proof: `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:145-172` renders the shipped command against a fixture and asserts `P1` — pass |
| R5 | MET | `packages/app/src/workflow/actions/agent-run.ts:292-320` — distinctness evaluated AFTER reviewer routing resolve and BEFORE dispatch; any violation returns the fail-closed reason. `packages/app/src/services/review-independence.ts:60-108` — three fail-closed branches, each naming the exact remedy (re-run implement for evidence; verify registry/role config; `roles.reviewer` tier override or explicit pin). Tests: `packages/app/tests/workflow/actions/agent-run.test.ts:2489` (same executor fails closed before dispatch), missing-evidence fail-closed (`:2506` block), `packages/app/tests/services/review-independence.test.ts:54,65,76` — pass |
| R6 | MET | Review and verify are separate `agent.run` executions with per-node fresh dirs (`fresh-review` vs `fresh-verify`, `packages/app/src/workflow/actions/agent-run.ts:206-214`), no session id, and fresh actions publish no session vars (`:609-618`) — neither can inherit the other's session nor leak into a later implement/test-fix resume. Covered by R1 test (`packages/app/tests/workflow/actions/agent-run.test.ts:2448`) and live pipeline declarations (R2) |
| R7 | MET | Review/verify resolve through the existing `AgentService.resolve({role})` registry path (`packages/app/src/workflow/actions/agent-run.ts:302-303`) with the pre-existing `role: reviewer` vocabulary (`task-pipeline.yaml:499,550`); no new agent framework or role names introduced (0710 diff touches only session/policy seams inside the existing runner + one pure module) |
| R8 | MET | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:121-148` — live-YAML test fails if review/verify lose `freshSession`, regain an executor pin, or drop role/compareExecutorWith/priority; composition baseline regenerated to the live definitions (`config/workflow-composition-baseline.json` task-pipeline digest `sha256:fd3a33934587a223950d869c6940a8ae219c72c6c911f37f073758f9e9555f50` = regen output; composition-baseline test green in gate). Enforcement location (live-YAML proof-chain test, baseline records kind/invocation only) documented in `docs/04_DESIGN.md:2278-2296` and the task Review section |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |

**Stage:** fresh-context independent review + bounded re-check, 2026-08-29. Scope: 0710 hunks in `.spur/run/0710-implement-diff.patch` (shared files carry earlier A6 batch tasks, still uncommitted).

Initial verdict: **BLOCK** — two required fixes, both remediated in the same session and re-verified:

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | `config/workflows/task-pipeline.yaml` (quality-gate shell) | Priority extraction dead: sed ran against the path-only `taskpath.txt`, so `taskPriority` was always empty and the P0/P1 distinct-executor policy never engaged | Fixed: sed now reads the task file via `"$(cat .spur/run/$wbs-taskpath.txt)"` + upper-normalization; executable proof-chain test renders the shipped command against a fixture and asserts `P1` |
| P2 | `composition-baseline.ts` / `docs/04_DESIGN.md` | R8 claim unenforced: baseline records kind/invocation only; a re-pinned executor or dropped `freshSession` would pass CI | Fixed: proof-chain test loads the live pipeline and pins review/verify `agent.run` options (freshSession / role reviewer / no agent pin / compareExecutorWith / priority var); docs sentence rewritten to the actual enforcement |
| P3 | `config/workflows/docs-pipeline.yaml` verify hop | Lacked `freshSession: true` | Fixed in-scope: one line added (single-agent pin kept — docs flow is single-agent by design, no priority var) |
| P4 | `agent-run.ts` pre-dispatch resolve | Double executor resolution when policy engages | Accepted as-is (cost-only) |

Correct-verified inventory: R1 fresh-session bypass (`packages/app/src/workflow/actions/agent-run.ts:176,185-187,200-219`), R2 declarations (`config/workflows/task-pipeline.yaml:497-503,548-555`), R3 bounded routing evidence (`packages/app/src/workflow/actions/agent-run.ts:612-625`, fail-closed parse `packages/app/src/services/review-independence.ts:40-58`), R5 fail-closed gate placement (`packages/app/src/workflow/actions/agent-run.ts:293-317`, exact remedies `packages/app/src/services/review-independence.ts:60-108`), R6 per-node fresh dirs, R7 role routing intact.

Bounded re-check verdict: **PASS** (P1/P2/P3 confirmed fixed, no re-opened findings). Gate: `bun run format && bun run spur-check` rc=0 — 6873 pass / 0 fail, all 2 rules passed.
### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I1 and Wave 4.
- `config/workflows/task-pipeline.yaml` — implement/review/verify agent actions.
- `packages/app/src/workflow/actions/agent-run.ts` — session latch and routing.
- `packages/app/src/services/agent-service.ts`
- `packages/app/src/observability/agent-execution.ts`
- `packages/config/src/index.ts` — role/executor configuration.
- `packages/app/tests/workflow/actions/agent-run.test.ts`

### History

- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-30T03:20:55.730Z todo → done (system)
- 2026-08-30T03:21:05.641Z done → wip (system)
- 2026-08-30T03:21:06.375Z wip → testing (system)
- 2026-08-30T03:21:06.780Z testing → done (system)
