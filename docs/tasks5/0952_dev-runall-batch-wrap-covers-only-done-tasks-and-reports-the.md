---
schema_version: 1
name: dev-runall batch wrap covers only done tasks and reports the rest
status: todo
template: feature-impl
created_at: 2026-09-24T18:59:37.121Z
updated_at: "2026-09-24T18:59:37.250Z"
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

- [ ] R1. Add "Step 6 — Batch wrap (`--wrap` / `--next`)" to execution-batch.md. Pass only the batch tasks whose terminal status is `done` as `vars.tasks`. Pass `vars.feature` only when every task in the frozen batch is `done` or `cancelled`; otherwise omit it and note "feature lifecycle not advanced: <n> task(s) unfinished". When the done subset is empty, skip the wrap with a reason instead of failing.
- [ ] R2. The batch report lists each excluded task with its status and recovery command. A task with a residual report uses the C6 recovery line; others use the next-router A-row command.
- [ ] R3. Fix dev-runall.md: the `--wrap` flag row says once per batch over the done subset, and the per-task wording is removed. Mirror this in the dev-operations.md runall entry and the help doc's `--next` chain section.

### Acceptance Criteria

- [ ] AC1 — Batch wrap covers only completed tasks (req: R1, R2, R3)

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

- [ ] Add Step 6 to plugins/sp/skills/spur-dev/references/execution-batch.md and extend the Step 5 report template with an "Excluded from wrap" block.
- [ ] Fix plugins/sp/commands/dev-runall.md:23 and the dev-operations.md runall entry.
- [ ] Update the help doc's `--next` chain section.
- [ ] Run `bun run spur-check`, which includes the flag-contract validators.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
