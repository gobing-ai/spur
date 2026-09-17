---
schema_version: 1
name: Route a contract violation to a repair edge, piloted on wrapup-pipeline
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.226Z
updated_at: "2026-09-17T00:46:46.348Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - agent-run
  - adr-118
  - pilot

dependencies: ["0870"]
done_forced: "true"
done_reason: "implement agent.run timed out at 1800000ms (subagent fc93fc63) with the work complete on disk; recovered from the partial tree, no restart. verify verdict is PARTIAL and is NOT rewritten to PASS: R1-R4 and AC 'Scenario: R8 - A contract violation routes to a repair outcome, not a full-stage retry' are MET with executable evidence (43 tests pass; real gate bun run spur-check PASS), and R5 is PARTIAL on exactly one conjunct - the pilot edge's behaviour recorded from REAL runs - which is structurally post-landing because the edge landed in this change and no real contract-violation routing decision can exist yet. R5's evidence path is wired (run-log [contract-violation] trigger, workflow.agent.contract-violation line, action-trace outcome/contract/observed) and the outstanding conjunct is owned by follow-up task 0876, which feeds the measurement to the ADR-076 promotion gate built by 0873. Operator-approved override at 2026-09-16T17:45Z; revert to testing if that call is wrong."
---

## 0871. Route a contract violation to a repair edge, piloted on wrapup-pipeline

### Background

Once a contract violation is named, the run can take a cheap path instead of re-dispatching a stage averaging 357 s. wrapup-pipeline is the pilot: 99 real runs and the best real completion rate on record, 9 states, 1 agent.run — small enough to iterate, real enough that the lesson transfers. This replaces the original proposal's plan to pilot on the untraced graphs.

### Requirements

- [x] R1. A definition may route the contract-violation outcome to a distinct outgoing edge.
- [x] R2. The repair path does not re-dispatch the full stage on its first attempt.
- [x] R3. The run log distinguishes a contract violation from an executor failure at the routing decision.
- [x] R4. A definition that declares no contract-violation edge behaves exactly as it does today.
- [x] R5. wrapup-pipeline carries the pilot edge and its evidence path records its behaviour from real runs, not fixtures. The first real-run routing decision is deferred to task 0876, which owns that conjunct and feeds the ADR-076 promotion gate — see the R5 status note in the Solution section.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry
    Given a stage whose output failed a declared contract check
    When the pipeline evaluates its outgoing transitions
    Then the run takes a distinct contract-violation edge
    And the repair path does not re-dispatch the full stage on its first attempt
    And the run log distinguishes a contract violation from an executor failure
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Routing is opt-in per definition: an absent contract-violation edge must leave today's behaviour untouched, or this change silently alters every pipeline at once. The first repair attempt is deliberately not a re-dispatch — re-running the same 357 s stage on the same inputs is what the measured 46% failure rate already buys. Pilot scope is one definition so the promotion evidence comes from real traffic before the pattern spreads.

### Plan

1. Add the contract-violation edge kind to the transition evaluation path, opt-in.
2. Verify a definition without the edge is unchanged (regression over existing definitions).
3. Add the pilot edge and repair action to wrapup-pipeline.
4. Record routing decisions in the run log with the violation name.
5. Collect real-run evidence for the pilot before proposing wider adoption.

### Solution

Introduce the `contract-violation` transition guard (ADR-118) and pilot it on `wrapup-pipeline`. A definition opts in by declaring a `contract-violation`-guarded edge; the guard passes iff the prior action's `data.outcome === 'contract-violation'` — task 0870's third stage outcome, kept distinct from an executor failure (whose `data` carries no discriminator). `onError: continue` on the pilot's `doc-sync` `agent.run` lets the transition guards read that result instead of halting, so a clean-exit contract miss routes to a cheap shell-only `repair` state (no re-dispatch) while an executor failure keeps its existing `failed` routing. The run log distinguishes the two at the routing decision via the transition `trigger` (`contract-violation` vs `executor-failure`), alongside 0870's `workflow.agent.contract-violation` line. Definitions without the edge are unchanged (R4): the guard is inert unless authored.

| Change | Anchor |
| --- | --- |
| `ContractViolationGuardRunner` — passes on `data.outcome === 'contract-violation'`, reports `contract`/`observed` | `packages/app/src/workflow/guards/contract-violation.ts:19` |
| Guard registered as a Spur builtin on the workflow host | `packages/app/src/workflow/builtins.ts:77` |
| Action schema exposes `onError` (`fail`/`continue`) so a failed `agent.run` can reach transition guards | `apps/cli/schemas/state-machine-workflow.schema.json:165` |
| Same `onError` exposure on the transition-flow action schema (shared capability) | `apps/cli/schemas/transition-flow-workflow.schema.json:144` |
| Pilot `doc-sync` `agent.run` declares `onError: continue` so guards read its result | `config/workflows/wrapup-pipeline.yaml:182` |
| Pilot contract-violation edge: `kind: contract-violation` routes to `repair` | `config/workflows/wrapup-pipeline.yaml:397` |
| Pilot success edge: `kind: action-ok` routes to `learnings-append` | `config/workflows/wrapup-pipeline.yaml:402` |
| Pilot executor-failure edge: `trigger: executor-failure` routes to `failed` | `config/workflows/wrapup-pipeline.yaml:409` |
| `repair` state is a cheap shell that records the miss — no `agent.run`/re-dispatch | `config/workflows/wrapup-pipeline.yaml:222` |
| `learnings-append` state holds the soft learnings append (moved out of `doc-sync`) | `config/workflows/wrapup-pipeline.yaml:201` |
| Run log routing distinction: `trigger: contract-violation` labels the repair decision | `config/workflows/wrapup-pipeline.yaml:395` |
| Inline-driver parity guard set gains `action-ok` and `contract-violation` | `plugins/sp/scripts/inline-pipeline-parity-check.ts:46` |
| Inline-driver reference lists the `action-ok` and `contract-violation` guards | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:28` |


#### R5 note (real-run evidence, not fixtures)

The pilot edge now lives in the canonical `wrapup-pipeline.yaml` (99 real runs on record; best real completion rate). R5's *promotion evidence* accrues from real wrap-up runs after this lands — recorded via the run log's `[contract-violation]` transition trigger, the `workflow.agent.contract-violation` line, and the action trace's `outcome/contract/observed` triple — not from a synthetic fixture. This task ships the routing and its executable regression pins; the ADR-076 promotion gate built by task 0873 consumes the measured real-run data before the pattern spreads to the other `agent.run` stages.

**R5 status at close (read this before reading the R5 checkbox).** The verify verdict for this task is **PARTIAL**, and it is PARTIAL on exactly one conjunct: the pilot edge's *behaviour* has not yet been observed on a real run, because no real contract violation can occur before the edge lands. The verdict artifact `.spur/run/0871-verdict.json` records that PARTIAL verdict; it was not rewritten to PASS. R5's checkbox is therefore checked for the scope this task delivered — the pilot edge carried by the canonical definition plus its wired real-run evidence path — and the outstanding conjunct (the first real-run routing decision, recorded from real data) is owned by **task 0876**, which also feeds the measurement to the ADR-076 promotion gate. Task 0871 was closed through the documented F6 provenance override with that partial recorded in its `done_reason`; if that is the wrong call, revert 0871 to `testing` and let 0876 carry R5 to completion.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | guard ContractViolationGuardRunner (packages/app/src/workflow/guards/contract-violation.ts:19) passes only when prior action data.outcome === 'contract-violation'; registered as a builtin guard on the workflow host (packages/app/src/workflow/builtins.ts:77); opt-in edge guard {kind: contract-violation} declared in config/workflows/wrapup-pipeline.yaml:397. Tests: packages/app/tests/workflow/guards/contract-violation.test.ts (6 pass) and packages/app/tests/workflow/builtins.test.ts 'registers the contract-violation guard with origin builtin (0871)'. |
| R2 | MET | repair state is shell-only (no agent.run, no re-dispatch) at config/workflows/wrapup-pipeline.yaml:222-236 and flows repair -> metrics-record (yaml:416-420); doc-sync agent.run declares onError: continue so guards read the result (yaml:182). Tests: packages/app/tests/workflow/wrapup-pipeline.test.ts 'repair is cheap (shell only) and never re-dispatches the agent'; packages/app/tests/workflow/builtins.test.ts '0871 R1/R2: a contract-violation agent.run result routes to the repair edge, not a re-dispatch'. |
| R3 | MET | transition trigger distinguishes the routing decision: trigger: contract-violation (config/workflows/wrapup-pipeline.yaml:395) vs trigger: executor-failure (yaml:409); run log renders the trigger via renderStepLine (packages/app/src/workflow/step-reporter.ts:142). Plus 0870's workflow.agent.contract-violation run-log line (packages/app/src/observability/workflow-run-log-sink.ts:204-212). Test: packages/app/tests/workflow/wrapup-pipeline.test.ts 'doc-sync routes contract violation → repair, success → learnings-append, failure → failed' asserts edge triggers ['contract-violation', null, 'executor-failure']. |
| R4 | MET | guard is inert unless authored — evaluate returns passed:false for success, executor failure, and no prior result (packages/app/src/workflow/guards/contract-violation.ts:27-33). Test: packages/app/tests/workflow/wrapup-pipeline.test.ts 'R4: only wrapup-pipeline declares the contract-violation edge (opt-in)' scans 8 other definitions; packages/app/tests/workflow/guards/contract-violation.test.ts 'fails on executor failure / success / no prior result'. |
| R5 | PARTIAL | Basis (a): the pilot edge IS carried by canonical wrapup-pipeline.yaml (yaml:395-409) and the real-run evidence PATH is wired — run-log [contract-violation] transition trigger (step-reporter.ts:142), workflow.agent.contract-violation run-log line (workflow-run-log-sink.ts:204), action trace outcome/contract/observed (packages/app/src/workflow/actions/agent-run.ts:186). The second conjunct — behaviour recorded from real runs, not fixtures — is NOT yet established: the task's own R5 note (docs/tasks5/0871_route-a-contract-violation-to-a-repair-edge-piloted-on-wrapu.md:85) states promotion evidence accrues from real wrap-up runs after this lands and is consumed by the ADR-076 gate from task 0873 (config/workflow-candidates.json empty; package.json:95 workflow-promotion-check). No real-run contract-violation routing decision observed yet; only fixture/regression pins present. Static reference alone does not satisfy R5. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry | MET | test | packages/app/tests/workflow/builtins.test.ts '0871 R1/R2: a contract-violation agent.run result routes to the repair edge, not a re-dispatch' (e2e: clean exit with empty answerFile → repair marker reached, trace carries contract-violation/answerFile/empty, no re-dispatch); packages/app/tests/workflow/wrapup-pipeline.test.ts '0871 contract-first routing' suite (onError continue, edge order repair/learnings-append/failed, repair shell-only). Command: bun test (3 files) → 43 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T00:32:52.929Z todo → wip (system)
- 2026-09-17T00:45:41.575Z wip → testing (system)
- 2026-09-17T00:46:46.342Z testing → done (system)

