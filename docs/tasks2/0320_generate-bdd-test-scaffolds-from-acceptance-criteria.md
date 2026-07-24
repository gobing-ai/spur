---
template: feature-impl
schema_version: 1
name: "Generate BDD test scaffolds from Acceptance Criteria"
description: ""
status: todo
type: task
profile: standard
feature_id: Q
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T19:16:11.465Z"
updated_at: "2026-07-24T19:20:51.282Z"
---

## 0320. Generate BDD test scaffolds from Acceptance Criteria

### Background
Task/feature AC is already machine-parsed into structured `ParsedScenario[]` — Given/When/Then steps, tags, outlines, examples — by `packages/domain/src/bdd/parser.ts`, and `checkAcCoverage` (`packages/app/src/services/task-check.ts:765`) verifies task-AC ⊆ feature-AC by normalized title. But there is no code-level link between a scenario and a test, so AC coverage is invisible in the test run.

This task generates a 1:1 **pending** test stub per AC scenario (an AAA skeleton with Given/When/Then as comments, tagged with the scenario's normalized title), making AC coverage directly visible and laying the groundwork for a future test⇄AC coverage check. Scope is deliberately **stubs, not executable e2e**: turning natural-language Gherkin into real assertions needs step-definition glue, which is unbounded; the implementer fills each stub body.
### Requirements
- R1. A CLI verb `spur task scaffold-tests <wbs>` emits one `test.todo` per AC scenario into `<workspace>/tests/**`. **Pass:** a task with three scenarios produces three pending tests, each named for its scenario.
- R2. Each stub carries the scenario's Given/When/Then steps as AAA comment sections plus a stable tag comment `// @ac:<normalizedTitle>`. **Pass:** the stub body reflects the parsed steps in order and the tag uses `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:30`).
- R3. Idempotent + non-destructive: re-running never overwrites a stub whose body was filled; new scenarios append; removed scenarios are flagged, not deleted. **Pass:** editing a stub body then re-running preserves the edit and reports drift for the removed scenario.
- R4. Scenario Outlines expand to one stub per Examples row (row data recorded as a comment). **Pass:** an outline with two example rows yields two stubs.
- R5. Output is `--json`-reportable (created / skipped / drifted counts). **Pass:** `--json` returns a structured summary; the command exits non-zero only on a write error.
### Acceptance Criteria
```gherkin
Feature: Scaffold BDD test stubs from Acceptance Criteria

  @core
  Scenario: One pending test per scenario
    Given a task whose Acceptance Criteria has multiple Gherkin scenarios
    When BDD scaffold generation runs for that task
    Then one pending test is written per scenario, each named for its scenario

  @core
  Scenario: Filled stubs are never clobbered
    Given a previously scaffolded stub whose body an author has filled
    When scaffold generation runs again
    Then the filled body is preserved and only new scenarios are appended

  @edge
  Scenario: Scenario Outline expands per example row
    Given an AC scenario outline with two example rows
    When scaffold generation runs
    Then two pending stubs are written with the row data recorded
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Change-map (reuses the existing `bdd` parser; adds a pure renderer + a service + one CLI verb).

| File:line | Change |
| --- | --- |
| `packages/domain/src/bdd/parser.ts` | Reuse — source `ParsedScenario[]` incl. `outline.examples`. No change. |
| `packages/domain/src/bdd/scaffold.ts` (new) | `renderScenarioStub(scenario, framework)` → a `bun:test` `test.todo` skeleton with Given/When/Then as AAA comments and a `// @ac:<normalizedTitle>` tag. Pure + unit-tested. |
| `packages/app/src/services/task-scaffold.ts` (new) | Read the task's Acceptance Criteria (`stripAcFence`), parse, merge with any existing stub file idempotently (preserve filled bodies, append new, flag drift), write through `FileSystem`. |
| `apps/cli/src/commands/task.ts` | Add the `scaffold-tests <wbs>` subcommand + `--json`. |
| `packages/domain/tests/bdd/scaffold.test.ts`, `packages/app/tests/services/task-scaffold.test.ts` | Cover R1–R5. |

**Idempotency (R3):** parse existing `// @ac:` tags in the target file to detect which scenarios already have (possibly filled) stubs; never rewrite a stub whose body diverged from the empty skeleton.
### Plan
1. Implement `renderScenarioStub` + outline expansion in `packages/domain/src/bdd/scaffold.ts` (pure, unit-tested first).
2. Implement merge/idempotency in `task-scaffold.ts` — parse existing `// @ac:` tags, preserve filled bodies, append new scenarios, flag drift.
3. Wire `spur task scaffold-tests <wbs>` + `--json` in `apps/cli/src/commands/task.ts`.
4. Tests R1–R5 (domain + app).
5. Same-commit `docs/04_DESIGN.md` — document the new CLI verb and stub file convention.

Note: independent of task 0321, but a later test⇄AC coverage *check* would consume 0321's finding codes to grade this output.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Q

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
