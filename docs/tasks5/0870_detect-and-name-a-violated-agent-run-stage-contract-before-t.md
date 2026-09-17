---
schema_version: 1
name: Detect and name a violated agent.run stage contract before the result is accepted
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.225Z
updated_at: "2026-09-17T18:34:17.905Z"
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
| R1 | MET | ContractName vocabulary + the three enforcement points re-read at `packages/app/src/workflow/actions/agent-run.ts:36,:623-633,:635-686,:698-732`; all five violation shapes asserted by agent-run.test.ts:2701,2741,2762,2784,2805 — re-run this run: `bun test tests/workflow/actions/agent-run.test.ts tests/observability/workflow-run-log-sink.test.ts` -> 155 pass / 0 fail / 433 expect. |
| R2 | MET | `contractViolation` re-read at `agent-run.ts:163-191` returns ok:false with outcome:'contract-violation' + contract + observed before any success return; per-shape assertions :2712-2717 etc. in passing set. |
| R3 | MET | Run-log sink re-read at `packages/app/src/observability/workflow-run-log-sink.ts:204-212`: emits `contract-violation <contract> observed=<observed> node=… agent=…`; sink test :388-429 and trace payload test :2716-2726 pass. |
| R4 | MET | outcome discriminator separates contract miss from executor failure; executor path keeps bare ok:false (`agent-run.ts:744-766`); typed WorkflowAgentContractViolationEvent at observability.ts:157,:272; discriminator presence/absence asserted at :2712-2717 and :2843 (passing). |
| R5 | MET | Executor failure path untouched, same bare ok:false framing; test :2843 asserts non-zero exit has no discriminator and no contract-violation event (passing). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — An expensive stage validates its contract before the result is accepted | MET | test | Re-run 2026-09-17: agent-run.test.ts:2701-2857 covers answerFile empty, expectFile missing/empty, requireDiff empty/out-of-scope — each ok:false with outcome/contract/observed before success; workflow-run-log-sink.test.ts:388-429 asserts the log line naming contract + observed. 155 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Contract vocabulary, discriminator shape, sink line format all match Design; no deviation on re-read. |
| P4 | secua | — | Violation naming is deterministic; executor semantics unchanged; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T21:55:07.616Z todo → wip (system)
- 2026-09-16T22:03:34.094Z wip → testing (system)
- 2026-09-16T22:03:35.500Z testing → done (system)

