---
schema_version: 1
name: spur-check enforces shared-workflow composition caps and pipeline-budget coverage
status: todo
template: feature-impl
created_at: 2026-09-10T23:51:14.074Z
updated_at: "2026-09-11T15:51:57.450Z"
feature_id: I21
priority: P2
tags:
  - gate
  - workflow

ac_numbering: task-local
dependencies: ["0823", "0824", "0825"]
---

## 0826. spur-check enforces shared-workflow composition caps and pipeline-budget coverage

### Background

ADR-115 makes an error-level composition finding a gate for shared definitions, and requires a `pipeline-budgets` entry for every shared workflow with a model query. Today:
- `config/pipeline-budgets.json` covers only the pipelines it lists. `history-anatomy` (4 queries), `feature-dev` (2), `wayfinder-resolution` (2) and `basic` (1) have no entry.
- The bundled-workflow validation loop in `apps/cli/tests/commands/workflow.test.ts` hard-codes 9 of the 11 `config/workflows` definitions and omits `pr-review.yaml` and `history-anatomy.yaml`.
- 0822 temporarily relaxes the two shipped-definition tests so they accept exit 1 with an error-level finding.

Implements:
- R19 — the shared-workflow composition gate fails on error-level findings
- R20 — every shared workflow with a model query has a pipeline budget

Ordering: last. It needs 0822 (finding `level`, exit 1) and the three extraction tasks 0823–0825, so the shipped catalog passes the gate the day it lands.

### Requirements

- [ ] R1. `bun run spur-check` validates every `config/workflows/*.yaml` definition with full schema resolution and fails on any error-level composition finding, naming the workflow, state and action key. The definitions are enumerated from the directory, not from a hard-coded list. Warn-level findings never fail it, and it passes on the shipped catalog.
- [ ] R2. `bun run spur-check` and `check-pipeline-budgets` both fail when a `config/workflows` definition with at least one model query has no entry in `config/pipeline-budgets.json`, and name it. A new entry records the live query count, with null wall-clock and cost budgets. A later count above an entry still needs a `decision` record.

Non-goals:
- Budget values. The gate checks that an entry exists, not that it covers the live count; `idea-pipeline` (budget 5, live 6) is unchanged.
- Project and registered layers. `workflow run`, `run --dry-run` and `continue` never consult findings (governance §1.3).
- Moving `check-pipeline-budgets` into `spur-check`. Its wall-clock half needs real runs.
- Budget entries for workflows that no longer exist.
- Warn-level findings and their reasons (0823–0825).

### Acceptance Criteria

```gherkin
Feature: spur-check enforces shared-workflow composition caps and pipeline-budget coverage

  Scenario: R1 — the shared-workflow composition gate fails on error-level findings
    Given a definition in config/workflows with an error-level composition finding
    When `bun run spur-check` runs
    Then the composition gate fails and names the workflow, state and action
    And warn-level findings do not fail it
    And the gate passes on the shipped config/workflows

  Scenario: R2 — every shared workflow with a model query has a pipeline budget
    Given config/pipeline-budgets.json and the definitions in config/workflows
    When the pipeline budget gate runs
    Then every definition with at least one model query has a budget entry
    And a definition without one fails the gate by name
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T15:51:57.449Z

Refined at depth=ready (refineall I21, 2026-09-11). Closed decisions:
- **Consent granted 2026-09-10** (governance §4, row 0822/0826) for the `spur-check` composition gate. No public verb or flag changes.
- **The gate is the bundled-workflow test, not a new script.**
  - The existing validation loop in `workflow.test.ts` already runs inside `spur-check`, with full schema resolution and an isolated cwd.
  - Enumerating the directory adds `pr-review` and `history-anatomy`, which the hard-coded list omits. Both validate with exit 0 from a clean cwd (probed 2026-09-11).
  - The findings assertion comes before the exit assertion, so a failure names the workflow, state and action key.
- **Relax restore.** 0822 relaxes `workflow.test.ts` and `init.test.ts` with the comment `// I21: exit 0 is restored by 0826 once 0823–0825 land`. This task restores strict exit 0 and removes both comments.
- **Coverage runs in `spur-check`; measurement stays outside it.** `check-pipeline-budgets` remains the deliberate measurement surface, because wall-clock needs real runs. The static coverage half runs in `spur-check` through the live test, and the CLI gate reports the same `MISSING BUDGET` failure.
- **New entries.**
  - Counts from `extractResolvedWorkflowFacts` on 2026-09-11: history-anatomy 4, feature-dev 2, wayfinder-resolution 2, basic 1.
  - Wall-clock and cost are null (unenforced, never 0), and the decision is null, because a pipeline absent from HEAD is not a raise.
  - Zero-query definitions (`task-lifecycle`, `feature-lifecycle`) need no entry. The existing `pr-review` entry of 0 stays.
- **idea-pipeline drift is out of scope.**
  - Its budget says 5, but the live definition has 6 model queries. The coverage gate checks presence, not value, so it passes.
  - `check-pipeline-budgets` reports the drift once idea runs are measured.
  - The fix is a raise to 6 with a decision recorded in the same commit, or dropping a query. That is the operator's call, and it is reported in the I21 handoff.
- **No vacuous pass.** `loadQueryCounts` returns `{}` on any read or parse error. The live test therefore asserts one count per `config/workflows/*.yaml` before checking coverage.

### Design

**Approach.** Both gates are assertions in suites that `bun run test` already runs inside `spur-check` and `spur-check-new` (the root `test` script covers `./apps/cli` and `./scripts`). The task adds no chain entry, no script and no public verb.

**R1: the shared-workflow composition gate** is the bundled-workflow validation loop in `apps/cli/tests/commands/workflow.test.ts` (:100-133 before 0822).
- Add a test-file helper that validates one file the way the loop does today: an isolated `createTempProject()` cwd, `dbUrl: ':memory:'`, full schema resolution and `--json`. It returns `{ exitCode, parsed, errorFindings }`, where
  ```ts
  errorFindings = (parsed.composition?.findings ?? [])
      .filter((f) => f.level === 'error')
      .map((f) => `${f.workflow} ${f.state} ${f.actionKey} ${f.measure.kind}=${f.measure.measured}`);
  ```
- Loop input: `readdirSync(join(REPO_ROOT, 'config', 'workflows')).filter((f) => /\.ya?ml$/.test(f)).sort()` replaces the hard-coded list. This adds `pr-review.yaml` and `history-anatomy.yaml`, and gates every future definition. The `@gobing-ai` directory is skipped.
- Per definition, in this order, so a failure names its findings before the exit code:
  1. `expect(parsed.valid).toBe(true)`;
  2. `expect(errorFindings).toEqual([])`;
  3. `expect(exitCode).toBe(0)`.
- Warn findings are not asserted. Validate exits 0 on warn-only definitions (0822), so they never fail the loop.
- Keep the test title `bundled workflows/${wf} validates (schema resolves)`. Replace the loop comment with: bundled definitions validate with full schema resolution and carry no error-level composition finding (ADR-115 gate over `config/workflows`, 0826).
- Negative gate test: run 0822's error-level fixture through the helper and expect exit 1 and exactly one `errorFindings` line naming the fixture's workflow, state and action key. 0822's warn-only fixture yields `[]` and exit 0. Reuse 0822's fixture YAML from the same file; do not add new fixtures.
- `apps/cli/tests/commands/init.test.ts:80-85`: restore `expect(exitCode).toBe(0)` and drop 0822's relax branch and comment.
- Done when `rg -n "restored by 0826" apps/cli/tests` returns nothing.

**R2: budget coverage** in `scripts/commands/pipeline-budgets.ts`.
- `export function checkBudgetCoverage(queryCounts: Record<string, number>, budgets: Record<string, PipelineBudget>): string[]` returns the sorted names whose count is above 0 and that have no key in `budgets`.
- `checkPipelineBudgets` calls it with `queryCounts` and `config.budgets`. For each name it writes `MISSING BUDGET: pipeline=<name> modelQueries=<n> has no entry in config/pipeline-budgets.json` to stderr and adds it to `failures`. The PASS/FAIL line is unchanged.
- Header comment: add one sentence. Coverage (0826) is static, so its live test runs in `spur-check`; the wall-clock half stays outside it.
- Tests: a new `describe('checkBudgetCoverage (0826 R2)')` in `scripts/commands/pipeline-budgets.test.ts`:
  - a model-query workflow without an entry is returned by name;
  - a zero-query workflow without an entry passes;
  - an entry for a zero-query workflow is allowed;
  - live: `counts = await loadQueryCounts()`. Assert `Object.keys(counts).sort()` equals the sorted `config/workflows/*.yaml` basenames, so a swallowed parse error cannot pass vacuously. Then assert `checkBudgetCoverage(counts, (await loadPipelineBudgets()).budgets)` is `[]`.
- `config/pipeline-budgets.json`: four entries after `pr-review`, each with `wallClockMs: null`, `tokenCostUsd: null` and `decision: null`.

  | Entry | `modelQueries` |
  | --- | --- |
  | `history-anatomy` | 4 |
  | `feature-dev` | 2 |
  | `wayfinder-resolution` | 2 |
  | `basic` | 1 |

  `source`: `"Coverage entry (0826 R2): the live definition's model-query count (extractResolvedWorkflowFacts, <implementation date>). No real-run measurement yet: wall-clock and cost are unenforced until measured, never 0."` A pipeline absent from HEAD is not a raise for `detectSilentRaises`, so no decision is needed.
- Re-read the counts on the implementation day. A value other than the table means a prerequisite changed a query list against its no-new-query requirement: stop and report it. Do not record it.

**Invariants.**
- Only `config/workflows` is gated; project and registered layers never are.
- There is no suppression list or allowlist (ADR-108). An error-level finding is fixed by extraction.
- The gate reads the validate JSON. There is no second measurement implementation.
- The `composition-baseline.test.ts` pins stay unchanged.
- Validate and trace output formats stay unchanged.

**Rejected.**
- A `scripts/commands` gate module with its own `spur-check` entry. It duplicates the in-process validate harness the CLI test already has, and adds a chain step for the same assertion.
- A script that spawns `spur workflow validate` per file. It needs a linked binary and bootstraps once per definition.
- Gating inside `workflow run`. It would block adopting projects' runs (governance §1.3).
- A per-workflow allowlist (ADR-108).
- A static `budget >= live count` check. It would fail `spur-check` on `idea-pipeline` today, and value changes need a recorded decision.

### Plan

1. Preconditions (R1, R2).
   - 0822–0825 are done.
   - `rg -n "restored by 0826" apps/cli/tests` lists the two relax sites.
   - `bun -e "import {loadQueryCounts} from './scripts/commands/pipeline-budgets.ts'; console.log(await loadQueryCounts())"` prints the Design counts.
2. R2 tests first. Add the `checkBudgetCoverage` describe, including the live test, to `scripts/commands/pipeline-budgets.test.ts`. Watch it fail: the unit tests on the missing export, and the live test on the four names.
3. R2 implementation.
   - Add `checkBudgetCoverage`, the `MISSING BUDGET` lines and the header sentence, then add the four budget entries.
   - Run `bun test scripts/commands/pipeline-budgets.test.ts` from the repo root.
   - Run `bun scripts/spur-dev.ts check-pipeline-budgets`: no `MISSING BUDGET` line. A `BUDGET EXCEEDED` line for `idea-pipeline modelQueries` is the known drift; report it, do not fix it.
4. R1 tests.
   - Add the helper and the negative gate test over 0822's fixtures.
   - Switch the loop to directory enumeration with the three ordered assertions, restore exit 0 in `init.test.ts` and update the loop comment.
   - `rg -n "restored by 0826" apps/cli/tests` returns nothing.
5. Verify (R1, R2).
   - Run `bun run --filter @gobing-ai/spur build:bundle`, since `init.test.ts` resolves the bundled copy.
   - Run `cd apps/cli && bun test tests/commands/workflow.test.ts tests/commands/init.test.ts`: 11 bundled-workflow tests pass.
   - Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
