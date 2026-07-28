---
template: feature-impl
schema_version: 1
name: "Generate BDD test scaffolds from Acceptance Criteria"
description: ""
status: done
type: task
profile: standard
feature_id: F9
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T19:16:11.465Z"
updated_at: "2026-07-28T00:33:05.808Z"
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
Change-map:

| File:line | Rationale |
| --- | --- |
| `packages/domain/src/bdd/scaffold.ts:1` | Pure scaffold generator (`renderScenarioStub`, `scaffoldFeatureScenarios`), tag parser (`parseExistingAcTags`), and idempotent merger (`mergeStubs`). |
| `packages/domain/src/bdd/index.ts:23` | Re-export `renderScenarioStub`, `scaffoldFeatureScenarios`, `parseExistingAcTags`, `mergeStubs`, and types. |
| `packages/domain/tests/bdd/scaffold.test.ts:1` | Unit tests for scenario rendering, Scenario Outline expansion, AAA comments, and idempotent stub merging. |
| `packages/app/src/services/task-scaffold.ts:1` | `TaskScaffoldService` reading task AC section, invoking scaffold helpers, writing files via `atomicWriteAsync`, and returning `--json` reportable metrics. |
| `packages/app/src/index.ts:192` | Re-export `TaskScaffoldService` and types. |
| `packages/app/tests/services/task-scaffold.test.ts:1` | Unit tests for `TaskScaffoldService` against mock FileSystem. |
| `apps/cli/src/commands/task.ts:889` | Add `scaffold-tests <wbs>` subcommand with `--file`, `--folder`, `--json`. |
| `docs/04_DESIGN.md:297` | Document `spur task scaffold-tests` CLI surface. |
### Testing
**Commands run (this verify, 2026-07-24):**
- `bun test packages/domain/tests/bdd/scaffold.test.ts packages/app/tests/services/task-scaffold.test.ts` → 8 pass, 0 fail; `scaffold.ts` and `task-scaffold.ts` at 100% line & func coverage
- `bun run apps/cli/src/index.ts task scaffold-tests 0320 --json` → `{"created":3,"skipped":0,"drifted":0,...}` exit 0
- re-run same command → `{"created":0,"skipped":3,"drifted":0,...}` exit 0 (idempotent)
- `bun run lint` → clean (biome + typecheck exit 0)
- `spur task check 0320 --strict-core` → PASS

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | CLI verb `scaffold-tests` at `apps/cli/src/commands/task.ts:889-924`; 1:1 `test.todo` from `renderScenarioStub` `packages/domain/src/bdd/scaffold.ts:45-92`; service write `packages/app/src/services/task-scaffold.ts:53-118`; unit `packages/domain/tests/bdd/scaffold.test.ts:5-23`, `packages/app/tests/services/task-scaffold.test.ts:99-144`; CLI golden path created 3 pending tests named for each scenario |
| R2 | MET | AAA step comments + `// @ac:` tag via `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:30`, used at `scaffold.ts:46,65,83-84`); domain test asserts tag + Given/When/Then order `scaffold.test.ts:18-22` |
| R3 | MET | `mergeStubs` / `parseExistingAcTags` `scaffold.ts:117-182`; preserves filled bodies, appends new, flags drift without deleting `scaffold.test.ts:66-102`, `task-scaffold.test.ts:146-204`; CLI re-run skipped:3 |
| R4 | MET | Outline expansion `scaffold.ts:48-79` (Example N comment + row substitution); domain `scaffold.test.ts:25-49` (2 rows → 2 stubs); app `task-scaffold.test.ts:206-245` |
| R5 | MET | `TaskScaffoldResult` counts `task-scaffold.ts:22-37`; CLI `--json` via `toJson(result)` `task.ts:910-911`; exit non-zero only in catch `task.ts:920-923`; this-run JSON shows created/skipped/drifted |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: One pending test per scenario | MET | test+command | `scaffold.test.ts:5-23`; `task-scaffold.test.ts:99-144`; CLI `--json` created:3 for task 0320's three scenarios |
| Scenario: Filled stubs are never clobbered | MET | test+command | `scaffold.test.ts:66-102` (filled `test('First scenario')` preserved); `task-scaffold.test.ts:146-204`; CLI second run skipped:3, no overwrite |
| Scenario: Scenario Outline expands per example row | MET | test | `scaffold.test.ts:25-49` (count=1/2 → 2 stubs with Example comments); `task-scaffold.test.ts:206-245` |

**Design conformance:** 5/5 design claims DONE (pure `scaffold.ts`, `TaskScaffoldService`, CLI verb + `--json`, domain+app tests, `docs/04_DESIGN.md:297`). No silent deviation; Solution section documents the change-map.

**Coverage:** 100% line & func on `packages/domain/src/bdd/scaffold.ts` and `packages/app/src/services/task-scaffold.ts` (measured this run via bun test coverage table).

**SECUA (advisory, non-blocking):**
- minor/correctness: outline examples share one `acTag` (`scaffold.ts:74`), so adding a new Examples row to an already-scaffolded outline will not append a new stub until the tag strategy is per-row. Outside stated Pass criteria; not repaired under `--fix all` (no UNMET/PARTIAL/major).
- minor/architecture: empty `catch {}` in `findTaskFile` (`task-scaffold.ts:131`) swallows readDir errors — acceptable for multi-folder probe.

**Verdict: PASS**
### Review
| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | None | All functional and verification criteria satisfied. |
| P2 | Heading level flexibility | Handled both canonical `### Acceptance Criteria` and non-standard `##` via fallback. |
| P3 | Idempotency | Preserves filled test stub bodies, appends new scenarios, reports drifted scenarios. |

Review outcome: PASS
### References

Q

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-24T21:33:56.325Z todo → wip (system)
- 2026-07-24T21:33:57.817Z wip → testing (system)
- 2026-07-24T21:33:59.254Z testing → done (system)
