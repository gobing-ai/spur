---
schema_version: 1
name: wrapup-pipeline stops changing feature status and validates tasks with one typed gate
status: todo
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-18T05:48:22.834Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - wrapup
  - breaking

dependencies: ["1246"]
estimate_hours: 8
---

## 1249. wrapup-pipeline stops changing feature status and validates tasks with one typed gate

### Background

wrapup-pipeline (config/workflows/wrapup-pipeline.yaml, 780 lines) passed 101 of 160 runs since 2026-09. It failed at task-resolve→failed (25) and feature-transition→failed (11). task-pipeline's done close already performs record, the residual sweep and feature sync. Covers feature scenarios R5, R6 and R7. Design: docs/design/workflow-consolidation.md §3.3, ADR-142.

**Refine correction (2026-10-18, depth ready).**

- The typed resolver already exists. `spur task wrapup resolve` (apps/cli/src/commands/task/wrapup.ts) runs `resolveTasks` (packages/app/src/workflow/wrapup/steps.ts:136). It writes `<runId>-wrapup-tasks.json`, `<runId>-wrapup-resolve.status` (PASS/FAIL) and a reason file. On a validation FAIL it **exits 0**; only an empty `__runId` exits 1.
- The YAML wraps the verb in a shell with a `|| printf FAIL` fallback (lines 175-180). It then runs the drift probe, a `file.read.into-var` and route-reason (181-221). The filed R2 ("introduce a typed resolver") is therefore restated: the gap is the shell wrapper and the exit contract, not the resolver.
- `command.gate` derives PASS/FAIL/BLOCKED from the exit code alone and writes its `resultFile` (packages/app/src/workflow/actions/command-gate.ts:22-30). Under today's exit-0-on-FAIL contract it would overwrite the step's FAIL with PASS, so the exit contract must change with it.
- The feature write path has more parts than the two states:
  - the `feature`/`featureGateCmd` vars;
  - `preflightFeature` (steps.ts:241, the 1033 R2 pre-flight inside resolve);
  - `classifySync` and `runFeatureTransition` (steps.ts:535, 599);
  - the `feature-transition` op and `--feature`/`--feature-gate-cmd` flags on `spur task wrapup` (wrapup.ts:11, 51-52);
  - metrics-record's three-way routing on `$feature` (YAML lines 690-712).
- The filed R3 (no repeat of record/sweep/sync) is met once R1 lands. wrapup never ran record or the sweep. It is folded into R1.
- `/sp:dev-wrapall --feature` selects tasks *and* advances the feature (plugins/sp/skills/spur-dev/references/dev-operations.md:509-511). Selection stays; advancing goes.

### Requirements

- [ ] R1. Remove the feature write path and leave no wrap-up state that writes task or feature status:
  - the `feature-transition` and `feature-verify` states and their edges;
  - the `feature` and `featureGateCmd` vars;
  - `preflightFeature`, `classifySync` and `runFeatureTransition`;
  - the `feature-transition` op and the `--feature`/`--feature-gate-cmd` flags of `spur task wrapup`.

  metrics-record routes PASS → branch-cleanup (merge=true) or done.
- [ ] R2. task-resolve validates with one `command.gate` (`spur task wrapup resolve`, resultFile `<runId>-wrapup-resolve.status`), not a shell wrapper. `resolveTasks` exits 1 on a validation FAIL and keeps writing its reason file. A crash or timeout reads BLOCKED and routes to `failed`. A validated `[]` still routes to `skipped`.
- [ ] R3. doc-sync, learnings-validate/append/repair, doc-tripwire, metrics-record and branch-cleanup keep their order, artifacts and outcomes:
  - doc-sync is one `agent.run` through the run's executor;
  - learnings-validate, learnings-append and repair are unchanged;
  - doc-tripwire, metrics-record and branch-cleanup are unchanged.

  The drift probe and route-reason remain.
- [ ] R4. The definition is at most 250 lines including comments.
- [ ] R5. `/sp:dev-wrap`, `/sp:dev-wrapall` and the dev-operations wrap/wrapall rows stop passing `feature`. `--feature` on wrapall only selects tasks and names `spur feature sync <id>` as the follow-up. The spur-cli tasks.md `wrapup <op>` row drops the removed op and flags.

Out of scope:
- The drift-probe and route-reason logic.
- The doc-sync prompt.
- Learnings shape rules.
- task-pipeline.
- Historical docs/plans.
- The broader skill sweep (1252).

### Acceptance Criteria

- [ ] AC1 — wrapup-pipeline never changes feature status (req: R1, R5)
- [ ] AC2 — wrapup-pipeline validates its task list with one typed gate (req: R2)
- [ ] AC3 — wrapup-pipeline keeps doc sync, the doc tripwire, metrics and the branch cleanup pause (req: R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:48:21.900Z

- Q: Introduce an `EMPTY` resolve status for the skip edge? A: No. The skip already keys on the validated capture length (`jq length … -eq 0`). That is the only skip proof, and a new status value adds a second one.
- Q: Convert drift-probe and route-reason to `command.gate` too? A: No. They are routing glue that already fails safe. The line budget comes from deleting the feature path and condensing comments.
- Q: Keep a deprecated `--feature` on `spur task wrapup` for old callers? A: No. The verb is workflow-internal (tasks.md:54), and its only caller is this YAML. A seeded old wrapup-pipeline copy is the 1251/1252 seeded-copy note.

### Design

Chosen: wrap-up owns post-task knowledge work only, and feature state belongs to feature-lifecycle (ADR-142). The forward hop is `feature sync` from task-pipeline's done close (1247). The resolver keeps its status-file protocol, and only its exit code becomes the gate signal.

Rejected:
- A soft feature-transition: it was the second-largest failure edge and a second writer.
- A combined `resolve+route` op: it widens a working verb for no failure-rate gain.

Invariant: a wrap-up run never changes any task or feature status.

File targets:
- config/workflows/wrapup-pipeline.yaml — the rewrite, version "12". Bundle copies via `bun run --filter @gobing-ai/spur build:bundle`.
- packages/app/src/workflow/wrapup/steps.ts:
  - `resolveTasks` `writeFail` returns `exitCode: 1`;
  - delete `preflightFeature`, `classifySync` and `runFeatureTransition`, and the `feature-transition` member of `WRAPUP_STEP_OPS`.
- packages/app/src/workflow/pipeline-steps.ts and packages/app/src/index.ts — drop the removed exports.
- apps/cli/src/commands/task/wrapup.ts — drop the op and the `--feature`/`--feature-gate-cmd` options and their help lines.
- packages/app/src/services/feature-sync-suppression.ts:6 — the comment names only the task-pipeline caller.
- Tests:
  - packages/app/tests/workflow/wrapup-pipeline.test.ts;
  - packages/app/tests/workflow/wrapup/steps.test.ts;
  - apps/cli/tests/commands/task/wrapup.test.ts;
  - apps/cli/tests/script-absorption-pr5-parity.test.ts plus fixtures/script-absorption-pr5/cases.ts — remove the feature-transition cases and flip the FAIL exit expectation.
- plugins/sp/commands/dev-wrap.md, dev-wrapall.md, plugins/sp/skills/spur-dev/references/dev-operations.md:495-511, execution-batch.md:464-486, 653, plugins/sp/skills/spur-cli/references/tasks.md:54.

Anti-patterns:
- No new `spur task wrapup` op.
- No new var.
- Do not weaken doc-tripwire or the 1147 scope checks.
- Do not touch packages/app/src/services/feature-transition.ts; it serves `feature update`, not wrap-up.

Handoffs:
- 1247 is the forward feature hop.
- 1248 owns the branch-cleanup operator pause on host runs.
- 1252 sweeps the remaining docs/03, satellites and the CHANGELOG `BREAKING CHANGE` (removed `--feature` var).

Execution budget: about 8h. Persisted artifacts: the YAML, steps.ts, tests and skill diffs. requireDiff: yes.

### Plan

- [ ] Write the failing E2E in packages/app/tests/workflow/wrapup-pipeline.test.ts: wrap a done task of a fixture feature, and assert the feature status is unchanged and the run ends `done`.
- [ ] Write the failing gate cases: malformed list, unknown WBS and non-done task → `failed` via exit 1; empty list → `skipped`; crash → BLOCKED → `failed`.
- [ ] Add a line-count assertion (≤250) and an assertion that no state id or var named `feature*` exists.
- [ ] Change `resolveTasks` to exit 1 on FAIL, delete the feature-path steps and op, and update the CLI flags and help.
- [ ] Rewrite wrapup-pipeline.yaml to the reduced shape, with task-resolve as a `command.gate`.
- [ ] Update dev-wrap, dev-wrapall, dev-operations, execution-batch and spur-cli tasks.md.
- [ ] Run build:bundle, then the targeted tests (packages/app wrapup tests, apps/cli task/wrapup + parity), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

