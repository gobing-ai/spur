---
schema_version: 1
name: "Anchor-drift detection: task check re-resolves line-number anchors against the current tree"
status: todo
template: feature-impl
created_at: 2026-08-27T19:44:59.611Z
updated_at: "2026-08-27T19:48:06.352Z"
feature_id: F94
priority: P2
---

## 0692. Anchor-drift detection: task check re-resolves line-number anchors against the current tree

### Background

Source edits silently rot line-number citations in done tasks. During the 0688 run, task 0606's
`eval-pipeline.ts:528` drifted to `:562` after 0688's +34-line edit — caught only post-commit,
by a human, not by any gate. `task check` already resolves anchor paths and bounds; it never
re-resolves whether the cited *line* still names the same content. This task files friction G-2
of F94 (and is why the F94 rider R5 prefers symbol anchors).

### Requirements

- [ ] R1. **Re-resolve line-number anchors in `task check`.** For each `path:line` anchor, resolve
      the path against the current tree and report drift when the cited content has moved — as a
      finding code or a report section, per existing finding-code conventions.
- [ ] R2. **Start at warning severity.** Drift means the citation is stale — real signal — but a
      warning first mirrors the ADR-088 disposition rule and the F91 promotion history (promote
      only with evidence the residue is true-positive rot, not formatting churn).
- [ ] R3. **Cheap enough for the iterate loop.** A single-task check must stay fast; no
      full-corpus re-read requirement. Tested.

### Acceptance Criteria

- [ ] AC1. Given a task citing `packages/app/src/services/eval-pipeline.ts:528` and the file
      shifted +34 lines, when `task check` runs, then drift is reported naming the cited and
      current positions.
- [ ] AC2. Given an anchor whose cited line still holds the cited content, when check runs, then
      no drift finding is emitted.
- [ ] AC3. Given the test suite, when it runs, then both the drift and no-drift paths are covered.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
