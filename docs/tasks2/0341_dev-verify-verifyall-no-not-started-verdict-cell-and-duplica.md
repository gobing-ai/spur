---
template: feature-impl
schema_version: 1
name: "dev-verify/verifyall: no 'not started' verdict cell, and duplicate follow-up task creation"
description: ""
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: ["sp-plugin", "verify", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.199Z"
updated_at: "2026-07-26T23:50:31.200Z"
---

## 0341. dev-verify/verifyall: no 'not started' verdict cell, and duplicate follow-up task creation

### Background

Two defects in the verify machinery, both surfaced by the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, findings P2 and P2).

**(a) Batch verdict grammar has no cell for 'not started'.** Running `/sp:dev-verifyall --feature R2 --auto --force` reached two `todo` tasks (0337, 0338) because `--force` bypasses the status guard — which is what `--force` means. Both necessarily scored FAIL, since nothing was implemented to trace, and the any-FAIL rollup then reported a batch verdict of **FAIL** for a feature whose five completed tasks all passed. "Not implemented yet" and "implemented and defective" are not the same result, and the aggregate cannot currently express the difference, so the headline verdict of a healthy feature reads as failure.

**(b) A follow-up task was created twice.** Tasks 0337 and 0338 carry byte-identical names ("Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10)"), created 9 seconds apart (20:07:45.935Z / 20:07:54.169Z). 0337 was left with placeholder-only sections; 0338 received all the content. Attribution: the follow-up-creation path of an earlier `/sp:dev-verify 0335 --fix all` run. The duplicate has since been cancelled by the operator, but the double-create path itself is untraced and will recur.

### Requirements
R1. Add a non-failing outcome (`NOT-STARTED` or `SKIPPED`) to the verifyall per-task verdict grammar for tasks that have not entered implementation, and exclude it from the any-FAIL batch rollup so it cannot mask or manufacture a batch failure.

R2. Make the batch summary report the excluded tasks explicitly — a reader must see that N tasks were skipped as unstarted rather than silently dropped from the count.

R3. Keep `--force` able to verify an unstarted task on request; this changes how the outcome is *classified and rolled up*, not whether the task can be reached.

R4. Trace the follow-up-task creation path used by `/sp:dev-verify --fix all` and identify how a single follow-up produced two task files 9 seconds apart. Fix the double-create; if it cannot be reproduced, record the investigation and add a guard against creating a second task with an identical name under the same feature within one run.

R5. Regression coverage for R1 (a batch of all-unstarted tasks does not report FAIL) and for R4 (single follow-up creates exactly one task).

R6. Update the verifyall operation contract in `plugins/sp/skills/spur-dev/references/dev-operations.md §3a` to document the new outcome and its rollup exclusion.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
