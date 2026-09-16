---
schema_version: 1
name: Detect and name a violated agent.run stage contract before the result is accepted
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.225Z
updated_at: "2026-09-16T22:03:35.500Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - agent-run
  - adr-118

dependencies: ["0868"]
---

## 0870. Detect and name a violated agent.run stage contract before the result is accepted

### Background

agent.run is 96% of workflow machine time (4,173 min over 723 actions) against shell's 3.3%. Within it, implement fails 83 of 180 runs (46%) after paying 9.9 min each. Sampled payloads split those failures into two populations the current single ok:false collapses: exitCode 3 executor errors, and exitCode 0 with ok:false — a clean agent exit that missed its own declared post-condition. Only the second is cheaply repairable, and it cannot be routed until it is named.

### Requirements

- [x] R1. An agent.run stage declaring answerFile, expectFile or requireDiff has that declaration treated as a contract.
- [x] R2. A violation is detected and named before the stage reports success.
- [x] R3. The run log and the action trace record which contract was violated and the observed value.
- [x] R4. A contract violation is distinguishable in the trace from an executor failure; the two are not both bare ok:false.
- [x] R5. Executor failure retains its existing semantics unchanged.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R7 — An expensive stage validates its contract before the result is accepted
    Given an agent.run stage declaring answerFile, expectFile or requireDiff
    When the stage produces an output that violates a declared contract
    Then the violation is detected and named before the stage reports success
    And the run log records which contract was violated and the observed value
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

This task establishes the third outcome and its evidence; routing is the next task's job, so the split keeps each diff reviewable. The check runs at the point the stage's result is accepted, using the post-conditions the YAML already declares — no new declaration syntax, because every expensive stage already states what it must produce. Naming the observed value matters as much as naming the contract: `expectFile empty` and `expectFile missing` need different repairs.

### Plan

1. Inventory the declared post-conditions across config/workflows/ and their current evaluation site.
2. Introduce the contract-violation outcome alongside success and executor failure.
3. Record contract name and observed value into the run log and the action_runs row.
4. Confirm executor-failure behaviour is byte-identical to before.
5. Test each declared post-condition's violation shape.

### Solution

Introduce the third `agent.run` stage outcome (ADR-118). A clean exit that violates its declared post-condition (`answerFile`, `expectFile`, or `requireDiff`) now returns `ok:false` with a `data.outcome: 'contract-violation'` discriminator plus `contract` and `observed`, emits a `workflow.agent.contract-violation` bus event, and the run-log sink names the miss — so the trace and the run log tell a contract miss from an executor failure before the stage reports success. Executor failure keeps its existing bare-`ok:false` shape unchanged (R5).

| Change | Anchor |
| --- | --- |
| `ContractName` vocabulary and the `contractViolation` helper — emits `workflow.agent.contract-violation` and stamps `data.outcome`/`contract`/`observed` onto the action result | `packages/app/src/workflow/actions/agent-run.ts:36` |
| `answerFile` empty answer after exit-0 is a named contract violation (`observed: empty`) | `packages/app/src/workflow/actions/agent-run.ts:627` |
| `expectFile` absent (`observed: missing`, partial-work artifact preserved) and present-but-empty (`observed: empty`) are distinct named violations | `packages/app/src/workflow/actions/agent-run.ts:652` |
| `requireDiff` empty implement (`observed: empty`) and out-of-scope diff (`observed: out-of-scope: <files>`) are named violations | `packages/app/src/workflow/actions/agent-run.ts:707` |
| `WorkflowAgentContractViolationEvent` type and the `workflow.agent.contract-violation` event-map entry | `packages/app/src/workflow/observability.ts:157` |
| Run-log sink handler and subscription — one line naming the violated contract and observed value | `packages/app/src/observability/workflow-run-log-sink.ts:204` |
| Contract-violation unit tests: each declared post-condition's violation shape, the non-violation pass, and the unchanged executor-failure shape | `packages/app/tests/workflow/actions/agent-run.test.ts:2685` |
| Run-log sink contract-violation line test | `packages/app/tests/observability/workflow-run-log-sink.test.ts:387` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Each declared post-condition is enforced at the result-acceptance boundary. `ContractName` vocabulary (`packages/app/src/workflow/actions/agent-run.ts:36`) names the three declarations; `answerFile` empty (`:623-633`), `expectFile` missing/empty (`:635-686`), and `requireDiff` empty/out-of-scope (`:698-732`) each route into `contractViolation`. Executable: `packages/app/tests/workflow/actions/agent-run.test.ts:2701,2741,2762,2784,2805` assert all five violation shapes. |
| R2 | MET | Detection and naming happen before success: `contractViolation` (`agent-run.ts:163-191`) returns `ok:false` with `data.outcome: 'contract-violation'`, `data.contract`, and `data.observed` — a clean exit (exitCode 0) that missed its declared post-condition never reaches the success return. Executable: every contract-violation test asserts `result.ok === false` plus the `outcome/contract/observed` triple (`agent-run.test.ts:2712-2717,2754-2760,2773-2779,2794-2800,2816-2820`). |
| R3 | MET | The action trace records the contract and observed value via `data.outcome/contract/observed` (`agent-run.ts:163-191`); the run log names both via the sink handler `onContractViolation` (`packages/app/src/observability/workflow-run-log-sink.ts:204-212`, subscribed at `:90`) emitting `contract-violation <contract> observed=<observed> node=… agent=…`. Executable: `packages/app/tests/workflow/actions/agent-run.test.ts:2716-2726` (trace payload) and `packages/app/tests/observability/workflow-run-log-sink.test.ts:388-429` (log line). |
| R4 | MET | The `data.outcome: 'contract-violation'` discriminator separates a contract miss from an executor failure; the executor path keeps its bare-`ok:false` shape with no `outcome/contract/observed` fields (`agent-run.ts:744-766` failure construction). The typed `WorkflowAgentContractViolationEvent` (`packages/app/src/workflow/observability.ts:157`) and its event-map entry (`:272`) make the distinction part of the bus contract. Executable: `agent-run.test.ts:2843` asserts a non-zero executor exit has no discriminator; `:2712-2717` asserts the violation result carries it. |
| R5 | MET | Executor failure semantics are unchanged: the non-zero/signal/dispatch-error path (`agent-run.ts:744-766`) is untouched by this task and returns the same bare `ok:false` with the same error-message framing (exit-code, signal, permission, dispatch). Executable: `agent-run.test.ts:2843` (`R5: a non-zero executor exit keeps its bare-failure shape (no contract discriminator)`) asserts `result.ok === false`, `error` contains `exited with code 3`, and no `outcome/contract/observed` fields, and no contract-violation event fires. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — An expensive stage validates its contract before the result is accepted | MET | test | Executable `test`: `packages/app/tests/workflow/actions/agent-run.test.ts:2701-2857` covers every declared contract's violation shape before success — `answerFile` empty (`:2701`), `expectFile` missing (`:2741`) and empty (`:2762`), `requireDiff` empty (`:2784`) and out-of-scope (`:2805`) — each asserting `result.ok === false` with the `outcome/contract/observed` triple, the non-violation pass (`:2728`), and the unchanged executor-failure shape (`:2843`). `packages/app/tests/observability/workflow-run-log-sink.test.ts:388-429` asserts the run log line naming the violated contract and observed value. Command (this stage): `bun test tests/workflow/actions/agent-run.test.ts tests/observability/workflow-run-log-sink.test.ts` → 155 pass / 0 fail (433 expect calls); `bun run typecheck` clean across all 7 workspaces; `biome check` on all 5 changed source/test files clean. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:b6a2d6d2b5b53533cba6220cf08a5c88a968f59f0e4e202fea5c6a5dde7917ad |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T21:55:07.616Z todo → wip (system)
- 2026-09-16T22:03:34.094Z wip → testing (system)
- 2026-09-16T22:03:35.500Z testing → done (system)

