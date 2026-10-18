---
schema_version: 1
name: Delete the inline bookkeeping verbs and parity scripts
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.821Z
updated_at: "2026-10-18T00:08:28.522Z"
feature_id: D65
priority: P2
tags:
  - workflow
  - cleanup
  - cli
estimate_hours: 3

dependencies: ["1241"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1242-verdict.json
---

## 1242. Delete the inline bookkeeping verbs and parity scripts

### Background

Feature D65 P3 exit, ADR-140 consequence. Once no workflow uses the inline driver, `spur workflow inline *` (11 sub-verbs), scripts/commands/inline-pipeline-parity-check.ts(+test) and inline-execution-contract.test.ts are dead; ADR-051 lists `workflow inline` as deleted, not migrated.

**Refine corrections (2026-10-17)**
- R1 "docs/plugin references" unenumerated → inline consumers: plugins/sp/skills/spur-dev/references/structured-trace-emission.md, inline-pipeline-driver.md, commands dev-idea/dev-plan/dev-run/dev-runall, parallel-execution/references/dispatch-surface.md, spur-cli/references/workflows.md, spec-decomposition/references/decomposition.md.

### Requirements

- [x] R1. Remove `spur workflow inline` and its sub-verbs, scripts/commands/inline-pipeline-parity-check.ts(+test) and inline-execution-contract.test.ts.
- [x] R2. Remove or rewrite the inline consumers: spur-dev references structured-trace-emission.md and inline-pipeline-driver.md, commands dev-idea/dev-plan/dev-run/dev-runall, parallel-execution/references/dispatch-surface.md, spur-cli/references/workflows.md, spec-decomposition/references/decomposition.md.
- [x] R3. Remove the ADR-071 proof-digest machinery not already removed by 1239.
- [x] R4. Public-surface removal is confirmed by the operator before merge (ADR-051 consent); spur-check-feature passes.

### Acceptance Criteria

- [x] AC1 — R13 — Remaining workflows migrate and the inline bookkeeping surface is removed (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Deletion only, after migration lands. grep every caller (plugins/sp, docs, scripts, tests) before deleting.

### Plan

- [x] Remove `spur workflow inline` and its sub-verbs, the parity check script + test, and the inline execution-contract test
- [x] Delete both driver references (`inline-pipeline-driver.md`, `structured-trace-emission.md`) and rewrite their pins
- [x] Rewrite the surviving consumers to the engine loop (dev-idea, dev-plan, dev-run, dev-runall, dispatch-surface, workflows.md, decomposition.md, super-planner, README)
- [x] Keep the WT-4 landing transport as flat `spur workflow persist-out|persist-check` (operator-reported rename, not a deletion)
- [x] Remove the remaining ADR-071 leftovers (inline-only shared option, attribution reader trimmed to its surviving consumers)

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/shared-options.ts:65` |
| `apps/cli/src/commands/workflow/index.ts:0` |
| `apps/cli/src/commands/workflow/index.ts:33` |
| `apps/cli/src/commands/workflow/index.ts:36` |
| `apps/cli/src/commands/workflow/index.ts:7` |
| `apps/cli/src/commands/workflow/index.ts:9` |
| `apps/cli/src/index.ts:115` |
| `apps/cli/src/index.ts:38` |
| `apps/cli/src/index.ts:54` |
| `apps/cli/src/index.ts:95` |
| `apps/cli/src/workflow-transport-argv.ts:10` |
| `apps/cli/src/workflow-transport-argv.ts:2` |
| `apps/cli/src/workflow-transport-argv.ts:8` |
| `apps/cli/src/workflow-transport.ts:0` |
| `apps/cli/src/workflow-transport.ts:11` |
| `apps/cli/src/workflow-transport.ts:16` |
| `apps/cli/src/workflow-transport.ts:19` |
| `apps/cli/src/workflow-transport.ts:20` |
| `apps/cli/src/workflow-transport.ts:22` |
| `apps/cli/src/workflow-transport.ts:3` |
| `apps/cli/src/workflow-transport.ts:5` |
| `apps/cli/src/workflow-transport.ts:9` |
| `apps/cli/tests/shared-option-parity.test.ts:0` |
| `apps/cli/tests/shared-option-parity.test.ts:28` |
| `apps/cli/tests/workflow-transport-argv.test.ts:11` |
| `apps/cli/tests/workflow-transport-argv.test.ts:16` |
| `apps/cli/tests/workflow-transport-argv.test.ts:23` |
| `apps/cli/tests/workflow-transport-argv.test.ts:25` |
| `apps/cli/tests/workflow-transport-argv.test.ts:5` |
| `apps/cli/tests/workflow-transport-argv.test.ts:7` |
| `apps/cli/tests/workflow-transport.test.ts:12` |
| `apps/cli/tests/workflow-transport.test.ts:21` |
| `apps/cli/tests/workflow-transport.test.ts:23` |
| `apps/cli/tests/workflow-transport.test.ts:30` |
| `apps/cli/tests/workflow-transport.test.ts:34` |
| `apps/cli/tests/workflow-transport.test.ts:36` |
| `apps/cli/tests/workflow-transport.test.ts:8` |
| `config/rules/surface/check-cli-surface.yaml:67` |
| `config/workflows/task-pipeline.yaml:633` |
| `docs/help/cmd_workflow.md:441` |
| `docs/help/cmd_workflow.md:448` |
| `docs/help/cmd_workflow.md:454` |
| `docs/help/cmd_workflow.md:461` |
| `docs/help/cmd_workflow.md:464` |
| `docs/help/spur-cli-matrix.md:121` |
| `docs/help/spur-cli-matrix.md:125` |
| `docs/help/spur-cli-matrix.md:21` |
| `docs/help/spur-cli-matrix.md:47` |
| `docs/help/spur-cli-matrix.md:62` |
| `docs/help/spur-cli-matrix.md:99` |
| `docs/reports/task-pipeline-baseline-comparison.md:102` |
| `docs/reports/task-pipeline-baseline-comparison.md:105` |
| `docs/reports/task-pipeline-baseline-comparison.md:114` |
| `docs/reports/task-pipeline-baseline-comparison.md:122` |
| `docs/reports/task-pipeline-baseline-comparison.md:125` |
| `docs/reports/task-pipeline-baseline-comparison.md:218` |
| `docs/reports/task-pipeline-baseline-comparison.md:290` |
| `docs/reports/task-pipeline-baseline-comparison.md:301` |
| `docs/reports/task-pipeline-baseline-comparison.md:306` |
| `docs/reports/task-pipeline-baseline-comparison.md:308` |
| `docs/reports/task-pipeline-baseline-comparison.md:31` |
| `docs/reports/task-pipeline-baseline-comparison.md:315` |
| `docs/reports/task-pipeline-baseline-comparison.md:320` |
| `docs/reports/task-pipeline-baseline-comparison.md:322` |
| `docs/reports/task-pipeline-baseline-comparison.md:325` |
| `docs/reports/task-pipeline-baseline-comparison.md:330` |
| `docs/reports/task-pipeline-baseline-comparison.md:334` |
| `docs/reports/task-pipeline-baseline-comparison.md:345` |
| `docs/reports/task-pipeline-baseline-comparison.md:349` |
| `docs/reports/task-pipeline-baseline-comparison.md:361` |
| `docs/reports/task-pipeline-baseline-comparison.md:368` |
| `docs/reports/task-pipeline-baseline-comparison.md:424` |
| `docs/reports/task-pipeline-baseline-comparison.md:475` |
| `docs/reports/task-pipeline-baseline-comparison.md:477` |
| `docs/reports/task-pipeline-baseline-comparison.md:512` |
| `docs/reports/task-pipeline-baseline-comparison.md:670` |
| `docs/reports/task-pipeline-baseline-comparison.md:687` |
| `docs/reports/task-pipeline-baseline-comparison.md:7` |
| `docs/reports/task-pipeline-baseline-comparison.md:792` |
| `docs/reports/task-pipeline-baseline-comparison.md:817` |
| `docs/reports/task-pipeline-baseline-comparison.md:825` |
| `docs/reports/task-pipeline-baseline-comparison.md:841` |
| `docs/reports/task-pipeline-baseline-comparison.md:91` |
| `docs/reports/task-pipeline-baseline-comparison.md:915` |
| `docs/reports/task-pipeline-baseline-comparison.md:925` |
| `docs/tasks5/1240_measure-the-rewritten-task-pipeline-against-the-32-run-basel.md:7` |
| `docs/tasks5/1240_measure-the-rewritten-task-pipeline-against-the-32-run-basel.md:77` |
| `package.json:93` |
| `package.json:96` |
| `package.json:99` |
| `packages/app/src/decision/decision-evidence-input.ts:6` |
| `packages/app/src/index.ts:444` |
| `packages/app/src/index.ts:445` |
| `packages/app/src/index.ts:446` |
| `packages/app/src/index.ts:448` |
| `packages/app/src/index.ts:902` |
| `packages/app/src/services/agent-doctor-ops.ts:32` |
| `packages/app/src/services/agent-quota-refresh.ts:24` |
| `packages/app/src/services/inline-run-log.ts:0` |
| `packages/app/src/services/inline-run-log.ts:4` |
| `packages/app/src/services/inline-run-log.ts:8` |
| `packages/app/src/services/verify-answer-lint.ts:405` |
| `packages/app/src/workflow/feature-verification-run.ts:23` |
| `packages/app/src/workflow/persist-check.ts:255` |
| `packages/app/src/workflow/persist-check.ts:28` |
| `packages/app/src/workflow/persist-check.ts:3` |
| `packages/app/src/workflow/persist-check.ts:5` |
| `packages/app/src/workflow/run-summary-render.ts:0` |
| `packages/app/src/workflow/run-summary-render.ts:3` |
| `packages/app/tests/services/persist-worktree-runs.test.ts:45` |
| `packages/app/tests/services/verify-answer-lint.test.ts:90` |
| `packages/app/tests/workflow/feature-verification-run.test.ts:17` |
| `packages/app/tests/workflow/persist-check.test.ts:17` |
| `packages/app/tests/workflow/run-summary-render.test.ts:10` |
| `packages/app/tests/workflow/task-diffstat.test.ts:234` |
| `packages/app/tests/workflow/task-diffstat.test.ts:237` |
| `plugins/sp/README.md:245` |
| `plugins/sp/agents/super-planner.md:291` |
| `plugins/sp/commands/dev-run.md:41` |
| `plugins/sp/commands/dev-run.md:44` |
| `plugins/sp/commands/dev-runall.md:108` |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:105` |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:107` |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:110` |
| `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:134` |
| `plugins/sp/skills/spec-decomposition/references/decomposition.md:56` |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md:82` |
| `plugins/sp/skills/spur-cli/references/workflows.md:122` |
| `plugins/sp/skills/spur-cli/references/workflows.md:278` |
| `plugins/sp/skills/spur-dev/SKILL.md:101` |
| `plugins/sp/skills/spur-dev/SKILL.md:106` |
| `plugins/sp/skills/spur-dev/SKILL.md:134` |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:113` |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:143` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:162` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:164` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:168` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:554` |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:109` |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:127` |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:88` |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:95` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:319` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:342` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:376` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:55` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:110` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:342` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:53` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:119` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:158` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:160` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:446` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:0` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:272` |
| `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:82` |
| `plugins/sp/tests/bootstrap-budget.test.ts:7` |
| `plugins/sp/tests/cli-surface-parity.test.ts:400` |
| `plugins/sp/tests/cli-surface-parity.test.ts:413` |
| `plugins/sp/tests/command-flag-parity.test.ts:26` |
| `plugins/sp/tests/command-flag-parity.test.ts:428` |
| `plugins/sp/tests/command-flag-parity.test.ts:432` |
| `plugins/sp/tests/commit-guard-docs.test.ts:21` |
| `plugins/sp/tests/commit-guard-docs.test.ts:27` |
| `plugins/sp/tests/commit-guard-docs.test.ts:8` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:10` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:12` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:14` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:16` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:4` |
| `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts:42` |
| `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts:45` |
| `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts:54` |
| `plugins/sp/tests/dogfood-testing/bookkeeping-contract.test.ts:8` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1154` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1163` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:187` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:203` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:212` |
| `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:301` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:100` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:14` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:32` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:37` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:38` |
| `plugins/sp/tests/dogfood-testing/startup-contract.test.ts:5` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:110` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:128` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:29` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:9` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:97` |
| `plugins/sp/tests/feature-verification-scope.test.ts:28` |
| `plugins/sp/tests/helpers/runbook-parts.ts:0` |
| `plugins/sp/tests/helpers/runbook-parts.ts:23` |
| `plugins/sp/tests/helpers/runbook-parts.ts:7` |
| `plugins/sp/tests/helpers/runbook-parts.ts:9` |
| `scripts/commands/inline-execution-contract.test.ts:0` |
| `scripts/commands/inline-execution-contract.test.ts:161` |
| `scripts/commands/inline-execution-contract.test.ts:204` |
| `scripts/commands/inline-execution-contract.test.ts:268` |
| `scripts/spur-dev.ts:29` |
| `scripts/spur-dev.ts:75` |
| `apps/cli/src/commands/workflow/persist.ts:1` |
| `apps/cli/tests/commands/workflow/inline-removal.test.ts:1` |
| `apps/cli/tests/commands/workflow/persist.test.ts:1` |
| `packages/app/src/services/inline-run-attribution.ts:1` |
| `packages/app/src/services/worktree-persist.ts:1` |
| `packages/app/tests/services/inline-run-attribution.test.ts:1` |
| `packages/app/tests/services/worktree-persist.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `spur workflow --help` no longer lists an `inline` command and `spur workflow inline begin` exits 1 with `unknown command` (pinned by `apps/cli/tests/commands/workflow/persist.test.ts`); `apps/cli/src/commands/workflow/inline.ts` and its four test files are deleted, as are `scripts/commands/inline-pipeline-parity-check.ts` + its test and `scripts/commands/inline-execution-contract.test.ts` |
| R2 | MET | Both driver references are deleted (`inline-pipeline-driver.md`, `structured-trace-emission.md`) with `inline-pipeline-driver.test.ts`; the surviving consumers were rewritten to the engine loop — `dev-idea`, `dev-plan`, `dev-run`, `dev-runall`, `parallel-execution/references/dispatch-surface.md`, `spur-cli/references/workflows.md`, `spec-decomposition/references/decomposition.md`, `agents/super-planner.md`, `plugins/sp/README.md` — and `tests/helpers/runbook-parts.ts` no longer declares them as a runbook part |
| R3 | MET | The ADR-071 leftovers 1239 did not remove are gone: the inline bookkeeping surface, the attribution reader that only the driver used (`inline-run-attribution.ts` now holds only the two consumers that outlive it), and the inline-only `runIdInline` shared-option entry. `spur workflow persist-out\|persist-check` survive as FLAT verbs (see the surface note below) |
| R4 | MET | The operator approved the two public-surface lists above — `tools.update_plan`-style list added no new entries beyond the approved removal — and the gate is green |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R13 — Remaining workflows migrate and the inline bookkeeping surface is removed (req: R1, R2, R3, R4) | MET | command | `spur task gate 1242 run` → `quality gate PASS` (log `.spur/run/1242-test-gate.log`, 11 500+ tests); `bun run lint` exit 0 (biome over 1566 files + 8 workspace typechecks); `spur workflow --help` shows `persist-out`/`persist-check` and no `inline` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-18T00:08:24.956Z todo → wip (system)
- 2026-10-18T00:08:25.514Z wip → testing (system)
- 2026-10-18T00:08:28.515Z testing → done (system)

