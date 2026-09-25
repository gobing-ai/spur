---
schema_version: 1
name: dev-runall batch wrap covers only done tasks and reports the rest
status: done
template: feature-impl
created_at: 2026-09-24T18:59:37.121Z
updated_at: "2026-09-25T00:21:47.738Z"
feature_id: F96
priority: P2
tags:
  - residual-sweep
  - runall
  - wrap
estimate_hours: 2

---

## 0952. dev-runall batch wrap covers only done tasks and reports the rest

### Background

`/sp:dev-wrap` correctly refuses tasks that are not `done` (wrapup task-resolve fails on any non-done/cancelled member, plugins/sp/scripts/wrapup-steps.ts:170-178). A partially completed `/sp:dev-runall --wrap/--next` batch must therefore wrap the finished subset and report the rest, instead of failing the entire wrap. This task is independent of the scanner tasks.

Premises (verified 2026-09-24):
- dev-runall.md contradicts itself: the flag table says `--wrap` runs "per task" (plugins/sp/commands/dev-runall.md:23), while the body says the wrap runs once after the batch (plugins/sp/commands/dev-runall.md:51-53, :67-72). dev-operations agrees with the once-per-batch reading (plugins/sp/skills/spur-dev/references/dev-operations.md:355).
- The batch driver steps end at "Step 5 — Batch report" (plugins/sp/skills/spur-dev/references/execution-batch.md:409). No step defines which WBS set the batch wrap receives.
- wrapup-pipeline takes `tasks` as a JSON-encoded string array plus an optional `feature` (config/workflows/wrapup-pipeline.yaml:29-32, :88-91).
- Feature lifecycle advance happens in wrapup `feature-transition`. Advancing a feature while some of its batch tasks are unfinished would overstate completion.

### Requirements

- [x] R1. Add "Step 6 — Batch wrap (`--wrap` / `--next`)" to execution-batch.md. Pass only the batch tasks whose terminal status is `done` as `vars.tasks`. Pass `vars.feature` only when every task in the frozen batch is `done` or `cancelled`; otherwise omit it and note "feature lifecycle not advanced: <n> task(s) unfinished". When the done subset is empty, skip the wrap with a reason instead of failing.
- [x] R2. The batch report lists each excluded task with its status and recovery command. A task with a residual report uses the C6 recovery line; others use the next-router A-row command.
- [x] R3. Fix dev-runall.md: the `--wrap` flag row says once per batch over the done subset, and the per-task wording is removed. Mirror this in the dev-operations.md runall entry and the help doc's `--next` chain section.

### Acceptance Criteria

- [x] AC1 — Batch wrap covers only completed tasks (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decisions:
- Filtering lives in the batch driver (skill prose), not in wrapup-pipeline. The wrap's refusal of non-done tasks stays a hard invariant; the driver simply stops handing it tasks it would refuse.
- Omitting `feature` on a partial batch keeps the wrap truthful: learnings and metrics are still captured, but the feature does not advance.
- Anti-patterns: no change to wrapup-pipeline.yaml or wrapup-steps.ts; no new runall flag.

### Plan

- [x] Add Step 6 to plugins/sp/skills/spur-dev/references/execution-batch.md and extend the Step 5 report template with an "Excluded from wrap" block.
- [x] Fix plugins/sp/commands/dev-runall.md:23 and the dev-operations.md runall entry.
- [x] Update the help doc's `--next` chain section.
- [x] Run `bun run spur-check`, which includes the flag-contract validators.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

| File | Change |
| --- | --- |
| plugins/sp/skills/spur-dev/references/execution-batch.md:442-456 | Step 5 template gains "Excluded from wrap" block (per-task status + recovery: C6 line for residual-reported tasks, router A-row otherwise). |
| plugins/sp/skills/spur-dev/references/execution-batch.md:482-497 | New "## Step 6 — Batch wrap (`--wrap` / `--next`)": done-subset vars.tasks, feature only when the whole frozen set is done/cancelled, empty-subset skip with reason; filtering stays in the driver (wrapup invariant untouched). |
| plugins/sp/commands/dev-runall.md:23 | --wrap flag row: once per batch over the done subset (contradiction removed). |
| plugins/sp/skills/spur-dev/references/dev-operations.md:355 | runall entry mirrors the batch-once/done-subset semantics. |
| docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:285-289 | --next chain section documents the batch-once wrap rule. |

Rationale: driver-side filtering preserves wrapup-pipeline's hard refusal of non-done tasks and omits feature advance on partial batches — no FSM or workflow change.


### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:482` Step 6 batch wrap over done subset only |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:448` excluded from wrap table with C6 and A-row recovery commands |
| R3 | MET | `plugins/sp/commands/dev-runall.md:23` flag row, `plugins/sp/skills/spur-dev/references/dev-operations.md:355` runall entry, and help doc |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1` passing tests |
| Scenario: R7 — Batch wrap covers only completed tasks | MET | test | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=2 housekeeping=0 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T22:38:04.704Z todo → wip (system)
- 2026-09-24T22:38:31.670Z wip → testing (system)
- 2026-09-24T22:38:32.021Z testing → done (system)

