---
schema_version: 1
id: "D62"
name: "Workflow execution economy: contract-first stages, inline traceability, and graph retirement"
status: active
priority: P2
tags: []
created_at: "2026-09-16T10:34:18.496Z"
updated_at: "2026-09-16T15:22:33.367Z"
---

# D62: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

## Goal

Make the spur-dev workflows economical to run: cut the model time lost to stages that fail their own
declared contract, and make the execution surface that actually runs most real work visible to the
structured trace that already exists.

The measured position this feature moves: `task-pipeline` completes 14.9% of real runs (31 done /
177 failed / 3 paused); `agent.run` is 96% of machine time (4,173 min) against `shell` at 3.3%
(141 min); the `implement` stage alone burns ~780 min on invocations that fail a post-condition after
averaging 9.9 min each; and 1,011 run rows carry no structured action trace at all because the
default inline driver logs to text rather than to `action_runs`/`system_events`.

Success means a measurably higher real-run completion rate and measurably less model time spent on
contract violations, both demonstrated from real run history rather than a synthetic fixture — the
evidence standard ADR-076 set when it retired the previous parallel-pipeline promotion bar.

## Scope

**In scope**

- Retire the workflow definitions with no real completions and no live caller (`basic`,
  `feature-dev`, and `docs-pipeline` subject to evaluation), reducing the reviewable surface.
  `task-lifecycle` and `feature-lifecycle` are **retained**: they are externally driven status FSMs
  with 564 and 136 real runs, and their absent `action_runs` rows reflect the trace gap this feature
  closes, not absent traffic.
- Expose the observability already built in `packages/app/src/workflow/`: a `spur workflow progress`
  read surface over `projectWorkflowProgress`, which currently has no CLI consumer.
- Give the inline pipeline driver a structured emission path so inline runs land in `action_runs` /
  `system_events` instead of only `.spur/run/<run-id>.log` (ADR-117).
- Repair event-contract defects that make the existing trace untrustworthy: the aliased
  `workflow.action.start` / `.started` and `.done` / `.finished` pairs, and the 276 of 443
  `agent.invoke.start` events recorded with a NULL `run_id`.
- Contract-first stage execution for the expensive `agent.run` nodes (`implement`, `verify`,
  `resolve-scope`, `doc-sync`): validate the stage's declared contract cheaply before accepting an
  expensive result, and route a contract violation to a named, cheap repair outcome instead of a
  full-stage retry (ADR-118).
- Split validation by the scope of the invariant it protects: task-local checks stay on the per-task
  pipeline, repo-wide checks (corpus consistency, traceability, contract baselines, doc sync)
  consolidate into one feature-scoped verification pass run once against a settled tree (ADR-119).
- A workflow-change promotion gate that satisfies the ADR-076 amendment: a candidate graph change is
  shadow-run against recorded real-run inputs and is promoted or deleted by a date named at creation,
  never left as a standing parallel file.
- Guard and shell-node legibility in the retained graphs, scoped as a correctness concern
  (`idea-pipeline` carries 27 shell guards / 3,023 chars; `task-pipeline` a 455-char guard).

**Out of scope**

- Merging or splitting `agent.run` stages purely to reduce node count — ADR-076 rejected a graph that
  added a model hop while claiming a performance goal; stage-count changes need the promotion gate's
  measured evidence first.
- Adding intermediate FSM states for monitoring before the emission path exists; state granularity is
  follow-on work justified by a failure cluster the repaired trace makes visible.
- Authoring new checks. ADR-119 relocates existing validation by scope; inventing additional gates is
  separate work.
- Any change to the dual-workflow engine's public action/guard kinds, the transport contracts in
  `packages/contracts`, or the domain schema.
- The dispatch-reliability gaps owned by feature P (`implementAgent=auto` resolution order, watcher
  report freshness, test-fix mutation policy).
- Executor/model selection policy and role-routing attribution, owned by D6 and J6.
- Board/web UI surfaces for the new progress data.

## Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R1 — Workflow definitions with no real completions and no live caller are retired
    Given a workflow definition that records zero runs reaching a "done" status within the retention window
    And no command, skill, agent, script, or config outside tests and documentation invokes it
    When the retirement change lands
    Then the definition is removed from config/workflows/
    And its config/pipeline-budgets.json entry is removed with it
    And "spur workflow list" returns only the retained definitions

  @core
  Scenario: R2 — Retirement is refused for an externally driven definition with real traffic
    Given a workflow definition that records runs but no action_runs rows because it is driven by requestTransition rather than by auto-run actions
    When retirement is evaluated for that definition
    Then the definition is retained
    And the evaluation reports the run count and most recent run that kept it
    And absence of action_runs rows is not treated as absence of traffic

  @core
  Scenario: R3 — A progress read surface exposes the existing projection
    Given a workflow run id with recorded states, actions and transitions
    When the operator runs "spur workflow progress <run-id> --json"
    Then the output is the projectWorkflowProgress projection for that run
    And it names the current state, each action's attempts, and the next candidate transitions
    And the command adds no new projection logic beyond rendering

  @core
  Scenario: R4 — Inline driver runs land in the structured action trace
    Given a pipeline driven by the inline driver with "--agent" omitted
    When the run reaches a terminal state
    Then every executed action has an action_runs row carrying node, kind, status, ok and duration_ms
    And the run's rows are queryable by its run id without reading .spur/run/<run-id>.log

  @core
  Scenario: R5 — Each workflow action emits exactly one start event and one finish event
    Given a workflow action executes once
    When its system_events rows are counted by event_name
    Then exactly one start event and one finish event are recorded for that action
    And no two event names describe the same action boundary

  @core
  Scenario: R6 — Agent invocation events carry the run they belong to
    Given an agent invocation dispatched from a workflow action
    When its "agent.invoke.start" and "agent.invoke.exit" events are persisted
    Then each event records the non-null run id of the dispatching run

  @core
  Scenario: R7 — An expensive stage validates its contract before the result is accepted
    Given an agent.run stage declaring answerFile, expectFile or requireDiff
    When the stage produces an output that violates a declared contract
    Then the violation is detected and named before the stage reports success
    And the run log records which contract was violated and the observed value

  @core
  Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry
    Given a stage whose output failed a declared contract check
    When the pipeline evaluates its outgoing transitions
    Then the run takes a distinct contract-violation edge
    And the repair path does not re-dispatch the full stage on its first attempt
    And the run log distinguishes a contract violation from an executor failure

  @core
  Scenario: R9 — A candidate graph change is promoted or deleted on measured real-run data
    Given a candidate workflow graph change proposed against a retained definition
    When the promotion gate is evaluated
    Then the verdict cites agent.run count and duration measured from real run history
    And the candidate is either promoted into the canonical definition or deleted
    And no unreferenced parallel definition remains in config/workflows/

  @core
  Scenario: R10 — Guard refactoring preserves routing semantics
    Given a retained definition whose transition guards are rewritten for legibility
    When each guard is evaluated against the same recorded variable and artifact state as before
    Then every guard returns the same routing decision as the pre-refactor definition

  @edge
  Scenario: R11 — The progress surface degrades gracefully on an unknown or incomplete run
    Given a run id that is unknown, still running, or missing action rows
    When the operator runs "spur workflow progress <run-id> --json"
    Then the command exits without error for a running or incomplete run and marks the missing data as unknown
    And an unknown run id produces a named error rather than an empty success

  @core
  Scenario: R13 — Repo-wide checks run once per feature, not once per task
    Given a validation check whose invariant spans the repository rather than a single task's diff
    When the per-task pipeline runs
    Then that check is not executed by the per-task pipeline
    And it is executed by the feature-scoped verification pass
    And the feature cannot reach "done" while that pass is failing

  @core
  Scenario: R14 — A task-local check stays on the per-task pipeline
    Given a validation check whose invariant is satisfied or violated by a single task's diff alone
    When the scope split is applied
    Then the check remains in the per-task pipeline
    And the per-task pipeline reports it without consulting the feature-scoped pass

  @edge
  Scenario: R12 — Trace emission failure never wedges or fails the run
    Given the inline driver cannot persist an action event
    When the run continues
    Then the workflow reaches its declared terminal state
    And the emission failure is recorded without changing the run's outcome

  @edge
  Scenario: R15 — Preparation evidence survives the pipeline's own deterministic mutations
    Given a planning pipeline that binds a task's preparation digest in one state and mutates that same task's dependency frontmatter in a later state
    When the later state verifies the recorded evidence against the task's current content
    Then the task is not reported stale on account of a mutation the pipeline itself applied
    And re-running the verifying state against an unchanged task reports the same outcome as the first run
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0866 | Retire workflow definitions with no real completions and no live caller | done |
| 0867 | Expose spur workflow progress over the existing projectWorkflowProgress projection | done |
| 0868 | Emit the structured action trace from the inline pipeline driver | done |
| 0869 | Repair the action-boundary event contract: collapse aliases and correlate agent invocations | done |
| 0870 | Detect and name a violated agent.run stage contract before the result is accepted | done |
| 0871 | Route a contract violation to a repair edge, piloted on wrapup-pipeline | done |
| 0872 | Split validation by scope: repo-wide checks move to a feature-scoped verification pass | done |
| 0873 | Gate a candidate workflow graph change on measured real-run data with a promotion deadline | done |
| 0874 | Refactor transition guards for legibility while preserving routing semantics | done |
| 0875 | Stop the idea pipeline from invalidating its own preparation evidence | done |
| 0876 | Record the contract-violation pilot's first real-run routing decision | todo |
| 0877 | Close out the D62 session-review findings that are neither fixed nor owned | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-16T10:58:07.227Z moved O → D62 (system)
- 2026-09-16T15:22:33.367Z backlog → active (system)

