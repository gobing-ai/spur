---
template: meta
schema_version: 1
name: "Fix J4 batch execution performance bottlenecks: test-loop spinning, L3 guard format discovery, lifecycle transition errors, and context pressure"
description: ""
status: done
type: meta
profile: standard
feature_id: H51
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-07-29T19:13:27.778Z"
updated_at: "2026-07-29T21:51:44.487Z"
---

## 0379. Fix J4 batch execution performance bottlenecks: test-loop spinning, L3 guard format discovery, lifecycle transition errors, and context pressure

### Background
The J4 implementation batch completed with passing task verdicts but consumed disproportionate time through repeated identical test runs, section-format discovery, verbose output, lifecycle retries, and unrelated git-state investigation. This task turns those observed failure modes into explicit, source-grounded execution guidance and regression contracts.
### Requirements
- [x] R1. Add a test-loop breaker to the pipeline or agent guidance that stops repeated identical failures and requires source inspection, a falsifiable hypothesis, and one edit before retrying.
- [x] R2. Add an L3 guard format cheat sheet covering the lifecycle graph, source citations, P1–P4 review table, verdict schema, and canonical section names.
- [x] R3. Add test-output discipline covering focused test selection, compact output, and preservation of the real test exit status.
- [x] R4. Add section-batching guidance that prepares Solution, Testing, and Review before the first task check.
- [x] R5. Document the real lifecycle transition graph and guarded transitions in `config/workflows/task-pipeline.yaml`.
- [x] R6. Add source-before-git-state debugging guidance to `sp:sys-debugging`.
### Acceptance Criteria
- [x] R1 — AC1. Repeated identical test failures trigger source inspection, a falsifiable hypothesis, and an edit before another retry.
- [x] R2 — AC2. The task-section reference exposes the real lifecycle graph, citation shape, review table, verdict schema, and canonical section names.
- [x] R3 — AC3. Test guidance favors focused execution and compact output while preserving the real exit status.
- [x] R4 — AC4. Pipeline guidance batches Solution, Testing, and Review before the first task check.
- [x] R5 — AC5. The workflow source documents valid task transitions and the guards on `wip -> testing` and `testing -> done`.
- [x] R6 — AC6. Debugging guidance prioritizes the failing test and source over unrelated git state.
### Q&A
**Q: Why create a separate meta task instead of fixing the issues inline during J4 execution?**

A: The J4 batch execution is complete (all 5 tasks done with PASS verdicts). These performance issues are process-level improvements to the harness skills and pipeline configuration, not code changes to the J4 feature itself. A separate meta task keeps the fixes traceable and prevents re-discovery in future batch runs.

**Q: Why are the fixes documentation/guidance changes, not code changes?**

A: The root causes are agent behavior patterns (test-loop spinning, format discovery, git stash investigation) not code bugs. The harness code (task-check.ts, task-record.ts, task-pipeline.yaml) is working correctly - it's enforcing the right constraints. The problem is that agents don't know the constraints until they hit them. Documenting the constraints in skill references makes them discoverable before the agent wastes time on trial-and-error.

**Q: Should R1 (test-loop breaker) be a hook instead of guidance?**

A: A PreToolUse hook that counts repeated bash commands and warns after 3 identical invocations would be more enforceable, but it requires state tracking across tool calls (the hook needs to remember previous commands). This is a future enhancement. The immediate fix is guidance in the `sp:code-testing` skill that agents read before debugging.

**Q: What's the expected time savings from implementing all 6 requirements?**

A: Based on the J4 batch analysis: 13.65h -> ~6h (55% reduction). Breakdown:
- R1 (test-loop breaker): ~4h saved (eliminates Run0376-style spinning)
- R2 (L3 cheat sheet): ~1.5h saved (eliminates format discovery)
- R3 (test output filtering): ~1h saved (reduces compactions)
- R4 (section batching): ~45min saved (reduces spur task calls)
- R5 (transition graph): ~30min saved (eliminates GuardDeniedError retries)
- R6 (git stash note): ~30min waste per occurrence eliminated

**Q: How should this task be decomposed for execution?**

A: The 6 requirements map to 6 independent fixes in different skill files. They can be executed in parallel (no dependencies between them). Suggested decomposition:
- Sub-task A: R1 + R3 (both in `sp:code-testing` skill)
- Sub-task B: R2 (in `sp:spur-cli` skill)
- Sub-task C: R4 (in `sp:spur-dev` skill)
- Sub-task D: R5 (in `config/workflows/task-pipeline.yaml`)
- Sub-task E: R6 (in `sp:sys-debugging` skill)

Or execute as a single task since each fix is a documentation addition (~50-100 lines per skill file).
### Design
The repair is a set of independent, discoverable guidance surfaces backed by one structural regression test:

1. `sp:code-testing` owns the repeated-failure breaker and output discipline.
2. `sp:spur-cli` owns the source-grounded L3 section and lifecycle cheat sheet.
3. `sp:spur-dev` owns batching of pipeline output sections.
4. `task-pipeline.yaml` carries comments for the task lifecycle and guarded transitions without changing executable workflow behavior.
5. `sp:sys-debugging` owns the source-before-git-state diagnostic order.

Each entry skill links its detailed reference. The structural test verifies the files, links, required phrases, and correspondence with the real lifecycle workflow so future documentation drift fails loudly.
### Plan
- [x] Step 1 (R2): Add and link the source-grounded L3 guard cheat sheet.
- [x] Step 2 (R5): Document the task lifecycle and guarded transitions in the pipeline workflow.
- [x] Step 3 (R1): Add and link the repeated-failure test-loop breaker.
- [x] Step 4 (R3): Add and link compact, exit-status-safe test output guidance.
- [x] Step 5 (R4): Add and link the section-batching protocol.
- [x] Step 6 (R6): Add source-before-git-state guidance.
- [x] Step 7: Validate skills, workflow, rules, lint, types, tests, coverage, and builds.
- [x] Step 8: Dogfood the combined guardrail suite and validate the report artifact.
### Solution
**Change map**

- `plugins/sp/skills/code-testing/SKILL.md:48` links the repeated-failure breaker and compact-output discipline (R1, R3).
- `plugins/sp/skills/code-testing/references/test-loop-breaker.md:1` defines the identical-signature stop condition, source/hypothesis/edit sequence, and retry caps (R1).
- `plugins/sp/skills/code-testing/references/test-output-discipline.md:1` defines focused execution, concise reporters, safe filtering, and exact Bash/zsh runner-status preservation (R3).
- `plugins/sp/skills/spur-cli/references/tasks/section-editing.md:94` links the L3 guard cheat sheet; `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md:1` records the source-grounded lifecycle, citation, review, verdict, and section formats (R2).
- `plugins/sp/skills/spur-dev/SKILL.md:120` links `plugins/sp/skills/spur-dev/references/section-batching.md:1`, which stages Solution, Testing, and Review before the first task check (R4).
- `config/workflows/task-pipeline.yaml:4` documents the real task lifecycle and guarded transitions without changing workflow execution (R5).
- `plugins/sp/skills/sys-debugging/SKILL.md:28` makes source and failing-test inspection precede unrelated git-state investigation (R6).
- `plugins/sp/tests/skill-structure.test.ts:904` verifies all six guardrails, their entry-skill links, matrix compatibility, and lifecycle source agreement.
- `config/tasks/section-matrix.yaml:135` permits causal evidence on `meta` tasks by making Root Cause optional across their lifecycle; `docs/04_DESIGN.md:759` records the surface contract.
- `packages/app/src/services/feature-check.ts:422` applies checklist parsing in both reverse feature coverage and scenario-satisfaction checks; `packages/app/tests/services/feature-check.test.ts:842` prevents regression.
- `docs/features/H51_batch-execution-reliability-guardrails.md:1` gives the six process acceptance criteria a truthful feature owner outside J4.

**Rationale**

Each guardrail lives with the competency that owns the behavior and is linked from its entry skill.
The regression tests check discoverability and source agreement so future prompt drift becomes a
failing test instead of a repeated batch failure. Closure repairs keep task metadata truthful:
process-level ACs link to H51, meta tasks can retain causal analysis, and checklist-form task ACs
participate in feature coverage and verdict verification.
### Root Cause

### Testing
**Fresh forced verification — 2026-07-29**

- Verdict: PASS after the bounded closure-repair pass.
- Gitignored evidence: `.spur/run/0379-verdict.json` uses canonical `AC-1` through `AC-6` IDs;
  `docs/dogfood/2026-07-29-H51-batch-execution-reliability-guardrails-trace.md` maps H51 to the
  original 0379 dogfood run without claiming a second execution.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/code-testing/references/test-loop-breaker.md:15` requires source inspection, a falsifiable hypothesis, one edit, and bounded retries. |
| R2 | MET | `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md:11` covers the lifecycle, citations, P1–P4 table, verdict schema, and canonical sections. |
| R3 | MET | `plugins/sp/skills/code-testing/references/test-output-discipline.md:11` requires focused output and exact Bash/zsh runner-status preservation. |
| R4 | MET | `plugins/sp/skills/spur-dev/references/section-batching.md:16` stages Solution, Testing, and Review before the first task check. |
| R5 | MET | `config/workflows/task-pipeline.yaml:23` documents the lifecycle and guarded transitions; workflow validation returned `valid=true`. |
| R6 | MET | `plugins/sp/skills/sys-debugging/SKILL.md:28` prioritizes assertion/source inspection over unrelated git state. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC-1 | MET | test | `plugins/sp/tests/skill-structure.test.ts:904`; full suite covers the R54 test-loop contract. |
| AC-2 | MET | test | `plugins/sp/tests/skill-structure.test.ts:935`; R54 verifies cheat-sheet discovery and formats. |
| AC-3 | MET | test | `plugins/sp/tests/skill-structure.test.ts:923`; R54 verifies focused output and exact Bash/zsh status propagation. |
| AC-4 | MET | test | `plugins/sp/tests/skill-structure.test.ts:957`; R54 asserts staging precedes the first task check. |
| AC-5 | MET | command | `bun run apps/cli/src/index.ts workflow validate config/workflows/task-pipeline.yaml --json` returned `ok=true`, `valid=true`. |
| AC-6 | MET | test | `plugins/sp/tests/skill-structure.test.ts:968`; R54 verifies source-before-git-state guidance. |

| Check | Status | Fresh evidence |
| --- | --- | --- |
| closure-regression | PASS | `packages/app/tests/services/feature-check.test.ts:842` proves checklist-form task ACs cover and verify feature scenarios; included in the full suite. |
| autofix | PASS | `bun run autofix`: Biome fixed one formatting delta; all seven workspace typechecks exited 0. |
| spur-check | PASS | `bun run spur-check`: 34/34 pre-check rules; 3,942 tests, 0 failures, 12,268 assertions; 99.36% functions / 99.20% lines; coverage and TSDoc passed. |
| lint | PASS | Included in `spur-check`: 561 files clean with no warnings; all workspace typechecks exited 0. |
| test-cf | PASS | `bun run test-cf`: 1 Worker test file and 1 test passed. |
| build | PASS | `bun run build`: CLI, server, and web builds exited 0; only the existing Vite chunk-size advisory remains. |
| worker-dry-run | PASS | `bunx wrangler deploy --dry-run --config apps/server/wrangler.toml`: 931.44 KiB upload / 157.72 KiB gzip; dry-run exited 0. |
| task-strict | PASS | `spur task check 0379 --strict --json`: no findings. |
| feature-strict | PASS | `spur feature check H51 --strict --json` and `spur feature check J4 --strict --json`: no findings; both features are done. |
| docs-sync | PASS | T3 is reflected in `docs/04_DESIGN.md` with version bump; H51 satellite plus refreshed `docs/features/INDEX.md` satisfy T4/T9. |

Coverage: 99.36% functions / 99.20% lines from the fresh full repository suite.
### Review
**SECUA findings** (forced closure verification — verdict: PASS)

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Security | — | No secret, permission, or untrusted-input surface changed; the 34-rule pre-check passed. |
| P4 | Efficiency | `plugins/sp/skills/code-testing/references/test-output-discipline.md:11` | Focused test selection and compact output retain the runner's exact exit status. |
| P4 | Correctness | `packages/app/src/services/feature-check.ts:422` | Checklist-form task ACs now participate in both reverse feature coverage and scenario verification; regression coverage passes. |
| P4 | Usability | `plugins/sp/skills/spur-dev/references/section-batching.md:16` | Agents stage the complete evidence trio before the first check, reducing write/check retries. |
| P4 | Architecture | `docs/features/H51_batch-execution-reliability-guardrails.md:1` | Process ACs have a dedicated H5 child instead of claiming coverage of the J4 product surface. |
| P4 | Quality gates | — | Autofix, lint/typecheck, 34/34 rules, 3,942 tests, coverage, TSDoc, test-cf, build, workflow validation, Wrangler dry-run, task strict, H51 strict, and J4 strict all pass. |

No unresolved task-scoped finding remains. The older H5 parent has a separate corpus-sharding
warning because its linked tasks live in `docs/tasks2` while the current feature checker resolves
the active `docs/tasks3` folder; H51 and task 0379 are independently strict-clean.
### References
- **J4 batch execution report**: `/skill:sp-dev-runall --feature J4 --auto --next --agent omp` output (Main session, 2026-07-29)
- **Performance analysis source**: Session JSONL logs at `~/.omp/agent/sessions/-xprojects-spur-new/`
  - Main session: `2026-07-29T04-54-05-620Z_*` (2.46h, 546 tools, 10 compactions)
  - Run0376: `2026-07-29T04-54-05-620Z_*/Run0376_*` (5.45h, 307 tools, 6 compactions, 103 test runs)
  - Run0375: `2026-07-29T04-54-05-620Z_*/Run0375_*` (4.05h, 228 tools, 5 compactions)
  - Refine0374–0378: 5 sessions in same subdirectory (1.65h total, 176 tools)
- **L3 guard source code**: `packages/app/src/services/task-check.ts`
  - `hasPopulatedPriorityTable()`: lines 94–104
  - Solution file:line check: lines 404–407
  - Review P1–P4 table check: lines 429–435
- **Verdict parsing source code**: `packages/app/src/services/task-record.ts`
  - `normalizeRequirements()`: lines 127–144
  - `normalizeAcceptanceCriteria()`: lines 146–157
  - `normalizeChecks()`: lines 159–168
- **Pipeline definition**: `config/workflows/task-pipeline.yaml` (8 steps: precheck -> implement -> test -> review -> approve -> verify -> record -> done)
- **Task-pipeline bug-742 warning**: task-pipeline.yaml step comments warn against recursive `spur workflow run` or `/sp:dev-run` invocation from within agent.run steps
- **Spur CLI task reference**: `~/.omp/plugins/cache/plugins/spur___sp___0.3.26/skills/spur-cli/references/tasks/verbs.md` and `section-editing.md`
- **Git commits (J4 batch)**: `dbf2fa2f` (0374 code), `4e6f2d20` (0374 done), `9ff3b4c5` (0375 code), `71881ef4` (0375 done), `c45e5ef6` (0376 code), `6b739d80` (0376 done), `53f36a02` (0377 code), `92d3c474` (0377 done), `ba3ea3c5` (0378 code), `2f9a6d95` (0378 done)
- **Test results (final)**: 3939 pass, 0 fail, 12199 expect() calls, 231 files
### History
- 2026-07-29T20:47:32.475Z backlog → todo (system)
- 2026-07-29T20:47:33.981Z todo → wip (system)
- 2026-07-29T21:09:49.196Z wip → testing (system)
- 2026-07-29T21:09:54.293Z testing → done (system)
### Notes

## RC1: Test-loop spinning (P0, ~4h waste)

**What happened**: Run0376 subagent ran `bun test tests/modules/observability/components.test.tsx` **103 times**, 79 of which were the exact same command with no source change between runs. The first 5 runs all produced the same failure:

```
expect(received).toBe(expected)
Expected: "tasks"
Received: "events"
```

The agent's response to this failure was to grep for `data-testid`, grep for `tab-switching`, grep for `ObservabilityTabs` - but never read the component source file or make an edit. It then created a `debug-test.tsx` file, ran the test again, got the same failure, and continued the loop.

**Root cause**: No protocol existed in the agent's skills to break out of a test-loop. The `sp:code-testing` and `sp:sys-debugging` skills describe TDD and debugging methodology but do not address the specific anti-pattern of repeatedly running the same failing test without changing source.

**Evidence**: Run0376 JSONL session log. Test command timestamps: 13:01:03, 13:01:28, 13:01:53, 13:02:18, 13:02:43 (first 5 runs, all same failure). Peak frequency: 13:02–13:06 (5 runs in 4 minutes). Total duration: 13:01 to ~14:17+.

## RC2: L3 guard format discovery via trial-and-error (P0, ~1.5h waste)

**What happened**: The agent needed to write Solution, Testing, and Review sections in formats enforced by L3 guards in `task-check.ts`. It did not know the formats, so it wrote sections, ran `spur task check`, got errors, rewrote sections, re-checked. This happened 26 times across 5 tasks (5.2 writes per task).

**Specific format failures**:

1. **Solution `file:line` citation** (0377, 0378): L3 guard at `task-check.ts:404-407` requires at least one `file:line` pattern in the Solution body. Agent wrote `:17-20` (bare line numbers) which failed the regex. Correct: `SupervisorTab.tsx:17-20`.

2. **Review P1–P4 table** (0374): L3 guard at `task-check.ts:429-435` calls `hasPopulatedPriorityTable()` (task-check.ts:94-104) which scans markdown table rows for a cell matching `/^\s*P[1-4]\s*$/` with at least one non-placeholder content cell. Agent wrote prose-only review without a table.

3. **Verdict JSON format** (0376): `normalizeRequirements()` at `task-record.ts:136-144` expects an array of objects `[{id, status, evidence}]`. Agent wrote a plain object `{R1: {status: "MET"}}`.

4. **"Verdict" section name**: Agent tried `spur task update --section Verdict`. "Verdict" is not canonical. Use `Notes`.

5. **Invalid lifecycle transitions** (7 events): Agent tried `todo->testing` (0374), `todo->done` (0376), which are invalid. Valid path: `todo->wip->testing->done`.

**Root cause**: The L3 guard format requirements are encoded only in TypeScript code (`task-check.ts`, `task-record.ts`) and are not surfaced as human-readable documentation in the `sp:spur-cli` skill references. An agent encountering the pipeline for the first time has no reference for the exact formats expected.

**Evidence**: Main session JSONL log. 20 `spur task check` calls, 26 `spur task update --section` calls. Per-task: 0374 (3 writes), 0375 (3), 0376 (4), 0377 (9), 0378 (5).

## RC3: Context window pressure from test output flooding (P1, ~1h waste)

**What happened**: 22 compactions across all sessions. The primary contributor was Run0376 with 6 compactions from 103 test runs. Each raw `bun test ... 2>&1 | tail -40` command added ~2000 tokens to context (full assertion diffs, source snapshots, stack traces). Over 103 runs, that's ~206K tokens of test output alone, far exceeding the context window.

**Root cause**: No guidance in the `sp:code-testing` skill on filtering test output. The agent used `tail -40` which includes full diff output. Filtered output (`grep -E "fail|pass|error" | tail -20`) would add ~500 tokens per run (~51.5K total), reducing compactions from 6 to ~1.

**Evidence**: Run0376: 6 compactions. Main session: 10 compactions (from verbose `spur task` JSON output and test runs). Run0375: 5 compactions.

## RC4: Section write retries from checking-then-fixing (P1, ~45min waste)

**What happened**: 26 section updates for 5 tasks. The pattern was: write Solution section -> check -> fail -> fix Solution -> check -> write Testing -> check -> fail -> fix Testing -> check -> write Review -> check -> fail -> fix Review -> check. Instead of: write all sections -> check once -> fix all -> check once.

**Root cause**: No batching guidance in the pipeline execution skills. The agent treated each section as a separate write-check cycle.

**Evidence**: Main session JSONL log. Section writes per task: 0374 (3), 0375 (3), 0376 (4), 0377 (9), 0378 (5). Average 5.2 writes per task vs. expected 2 (one initial write + one fix).

## RC5: Git stash red herring (P2, ~30min waste)

**What happened**: Run0375 found a git stash (`config-yaml-unrelated`) and spent 4 tool calls (~20 minutes) investigating it: `git stash list`, `git stash show -p`, `git stash show --name-only`, `git branch --show-current`. The stash contained only `.spur/config.yaml` changes and was unrelated to the test failure in `apps/web/src/modules/observability/`.

**Root cause**: No guidance in `sp:sys-debugging` on when git state is relevant to test failures. The agent's default behavior was to investigate all anomalous git state, even when the failure was clearly in application code.

**Evidence**: Run0375 JSONL session log. 4 git-related tool calls between test failure and fix.

