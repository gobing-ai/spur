---
template: meta
schema_version: 1
name: "Fix dev-flow waste: isolate flaky test failures and lint before the comprehensive gate"
description: ""
status: todo
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T06:08:34.766Z"
updated_at: "2026-08-09T06:53:17.678Z"
---

## 0488. Fix dev-flow waste: isolate flaky test failures and lint before the comprehensive gate

### Background
Task 0485 (agent executor exhaustion failover) took ~2.7h of tool activity inside a single ~5.1h
OMP session (`019fe3f7`, 2026-08-08 ~17:41-22:46 local). Forensic analysis of the raw session
JSONL (280 tool executions, **0 compactions, 0 guard failures, no repeated-command loops**) shows the
dominant cost is legitimate task complexity — 6 requirements across 4 packages (`agent-service.ts`,
`workflow-service.ts`, `stage-registry/schema.ts`, `agent-run.ts`) and 20+ new tests — not a fixable
defect.

Two concrete avoidable wastes emerged, both **S2** (process hygiene, not code bugs):

1. **Flake chase with full-suite re-runs (0484 phase).** A transient 2-fail in the full
   `apps/cli/tests` suite was chased with **13 full-suite re-runs** over ~27 wall-clock minutes
   (00:52-01:19) before it was confirmed transient and unrelated to the change under test. At
   ~18-25s per run that is ~5-6 min of redundant suite execution plus re-reading to hunt the failing
   test.
2. **Comprehensive gate run before lint-clean (0485 phase).** `bun run spur-check` was run twice:
   the first (04:26) failed only on biome formatting of the new test files; `biome check --write`
   fixed it and a second full gate (04:33) passed. One ~60s gate cycle was wasted on a mechanical,
   lint-detectable issue.

Neither is a code bug. Both stem from the inline pipeline-driving flow skipping steps the
`task-pipeline.yaml` `test` step already encodes (`bun run format && bun run spur-check` runs
format first) and the targeted-test-first discipline AGENTS.md already documents.
### Requirements
- [ ] R1. Isolate flaky full-suite failures before re-running the whole suite — when a full `bun test` run reports a small failure set, re-run the failing test file with `--test-name-pattern` once to confirm it reproduces in isolation; only re-run the full suite after a source fix. Record the guidance where the targeted-test-first discipline already lives (AGENTS.md / `sp-code-testing` reference) and follow it in inline pipeline runs.
- [ ] R2. Lint/format changed files before the comprehensive gate when driving the pipeline inline — run `bunx biome check --write` (or `bun run format`) on the changed files before `bun run spur-check`, mirroring the pipeline `test` step's format-first order, so a mechanical biome failure cannot waste a full gate cycle.
### Acceptance Criteria
Feature: dev-flow waste — isolate flaky failures and lint before the gate

  Scenario: R1 a transient full-suite failure is isolated before a full-suite re-run
    Given a full `bun test` run reports 1-2 failures
    When the operator investigates the failure
    Then they re-run the failing test file in isolation (`--test-name-pattern`) first
    And the full suite is not re-run more than once without an intervening source change

  Scenario: R2 changed files are lint-clean before the comprehensive gate
    Given changed source or test files
    When driving the pipeline inline and about to run `bun run spur-check`
    Then `bunx biome check` passes on the changed files (or `bun run format` was applied) first
    And no full gate cycle is wasted on a biome formatting failure
### Q&A
- Q: Was task 0485 itself slow because of a defect?
  - A: No. The ~2.7h is mostly legitimate work — 6 requirements across 4 packages, 20+ new tests,
    and 9 targeted/full test runs. The session had 0 compactions, 0 guard failures, and no
    repeated-command loops. The two wastes found are S2 (process) and not the driver of the wall
    clock.
- Q: Why is the flake-chase the biggest finding even though it is in the 0484 phase, not 0485?
  - A: It is the largest single avoidable cost in the session: 13 full `apps/cli/tests` re-runs
    over ~27 wall-clock minutes to confirm a transient 2-fail. The suite is cheap (~20s each) but
    the repeated full re-runs plus re-reading to locate the failing test added ~5-6 min and several
    minutes of reasoning. Isolating via `--test-name-pattern` removes the whole loop.
- Q: Why did `spur-check` run twice for 0485?
  - A: The inline flow ran the comprehensive gate before the new test files were biome-clean. The
    first run failed purely on biome line-wrap formatting; `biome check --write` fixed it and the
    re-run passed. The pipeline `test` step already runs `bun run format` before the gate — the
    inline path skipped that format-first order.
- Q: Are these worth fixing?
  - A: Yes, but low priority (S2 / P3). They are guidance/adherence fixes, not code defects.
    Codifying them prevents recurrence at near-zero cost — the fix is a few lines of guidance plus
    following it.
- Q: Could this be a hook or a rule rather than guidance?
  - A: Partially. The biome-before-gate issue is already caught by the pre-commit / lint gate (that
    is exactly why spur-check failed before biome ran). The flake-triage is a judgement discipline
    (distinguish flaky from real before re-running the suite) and belongs as guidance in
    `sp-code-testing`, not a deterministic hook.
- Q: Will fixing this change 0485-type task durations materially?
  - A: No. 0485 was large and most of its time was legitimate. These fixes remove minutes of
    avoidable waste per task, not hours; they matter for hygiene and throughput across many tasks,
    not for any single large task.
### Design
- **RC1 — test-loop / flake chase (0484 phase).** Evidence: 13 `bun test apps/cli/tests` runs at
  `00:52:37`-`01:19:43` (~27 wall-clock min); a transient 2-fail was re-run repeatedly with
  different grep filters to locate it, then confirmed stable (unrelated to the change under test).
  Root cause: the targeted-test-first discipline (AGENTS.md: run the narrow target before the
  full suite) was not applied to flake triage — the whole suite was re-run each time instead of
  isolating the failing test with `--test-name-pattern`. Fix: R1.
- **RC2 — comprehensive gate before lint-clean (0485 phase).** Evidence: `bun run spur-check` at
  `04:26:25` failed on biome formatting of the new test files; `biome check --write` at `04:28:20`;
  `spur-check` re-run at `04:33:57` passed. Root cause: driving the pipeline inline skipped the
  `test` step's format-first order (`bun run format && bun run spur-check`); the changed files were
  not biome-clean before the expensive gate. Fix: R2.
- **What worked well (preserve):** 0 compactions and 0 guard failures in the whole session; the
  pipeline's own `test` step (format-first then gate) is the correct pattern to mirror inline.
### Plan
- [ ] Add a flake-triage pointer (isolate the failing test with `--test-name-pattern` before full-suite re-runs) next to the targeted-test-first discipline (R1)
- [ ] Document lint/format-before-gate for inline pipeline driving (R2)
- [ ] Run `spur task check 0488` to green (R1-R2)
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session log: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-09T00-41-10-472Z_019fe3f7-6a48-7000-9111-2fdac908f835.jsonl` (OMP, source=omp, High fidelity; 280 tool executions, 0 compactions)
- Task 0485: `docs/tasks3/0485_agent-executor-exhaustion-failover-classifier-coverage-imple.md` (the slow task under analysis)
- Task 0484: `docs/tasks3/0484_fix-feature-n-batch-defects-worktree-merge-contradiction-p.md` (the flake-chase phase)
- Guidance owners: `AGENTS.md` (targeted-test-first; verification gate), `config/workflows/task-pipeline.yaml` `test` step (format-first gate)
- Methodology: `sp-issue-finding` (5-phase protocol: DISCOVER/ANALYZE/IDENTIFY/PROPOSE/GENERATE)
### History
### Notes

**RC1 — flake chase with full-suite re-runs.** Session `019fe3f7` ran the full `apps/cli/tests`
suite **13 times** between `00:52:37` and `01:19:43` (~27 wall-clock minutes) to investigate a
transient 2-fail that was ultimately confirmed transient and unrelated to the change under test
(the real-subprocess async-cancel test is timing-sensitive). Each run ~18-25s → ~5-6 min of
redundant suite execution, plus the repeated re-reading to locate the failing test. Root cause: the
targeted-test-first discipline was not applied to flake triage — the whole suite was re-run
(repeatedly, with different grep filters) instead of re-running the failing test file once with
`--test-name-pattern` to distinguish flaky from real.

**RC2 — comprehensive gate run before lint-clean.** For 0485, `bun run spur-check` ran twice:
`04:26:25` failed only on biome formatting of the newly-added test files; `biome check --write` at
`04:28:20` fixed it; `04:33:57` passed. Root cause: driving the pipeline inline skipped the
`test` step's format-first order (`bun run format && bun run spur-check`), so the mechanical biome
failure consumed a full ~60s gate cycle plus the fix.

**What worked well (preserve):** the session had **0 compactions** and **0 guard failures**; the
pipeline `test` step's format-first-then-gate shape is the correct pattern to mirror when driving
inline.

