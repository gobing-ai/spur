---
schema_version: 1
name: "Fix resolveRepoRoot cwd-dependence: repo-root resolution must not depend on the invoking directory"
status: cancelled
template: feature-impl
created_at: 2026-08-27T19:45:20.158Z
updated_at: "2026-08-27T20:11:34.634Z"
feature_id: F94
priority: P3
---

## 0697. Fix resolveRepoRoot cwd-dependence: repo-root resolution must not depend on the invoking directory

### Background

Rider from the 0688 friction review (F94): `resolveRepoRoot` depends on the invoking cwd — a
pre-existing bug, verified via stash during the 0688 session. Repo-root resolution that varies
with where the CLI is invoked from breaks every path-anchored check when an agent works from a
nested directory. S-size fix.

### Requirements

- [ ] R1. **Fix the cwd dependence.** Repo-root resolution must return the same root regardless
      of the invoking directory.
- [ ] R2. **Regression test** invoking resolution from a nested directory.

### Acceptance Criteria

- [ ] AC1. Given invocation from the repo root and from a nested directory, when the repo root is
      resolved, then both resolve to the same root.

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

- 2026-08-27T20:11:34.634Z todo → cancelled (system)
