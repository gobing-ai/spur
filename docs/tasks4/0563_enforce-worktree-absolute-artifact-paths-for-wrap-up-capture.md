---
template: issue
schema_version: 1
name: "Enforce worktree-absolute artifact paths for wrap-up capture steps"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P3
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:15.539Z"
updated_at: "2026-08-14T18:16:01.443Z"
---

## 0563. Enforce worktree-absolute artifact paths for wrap-up capture steps

### Background
During the E6 batch wrap-up (2026-08-14), the wrapup-pipeline's learning-capture agent.run step dispatched a subagent to write `.spur/run/wrapup-learnings.md`; the subagent wrote the artifact relative to its own sandbox cwd instead of the worktree, so the follow-up append shell read an empty/missing file and skipped the append. The learnings had to be reconstructed manually from first-hand session knowledge. Root cause: the dispatch input named a relative path and the capture step's answerFile path was not enforced against the process cwd (worktree). Evidence: append shell output `empty capture - skip` at 17:22:43; missing `.spur/run/wrapup-learnings.md` in the worktree; report §4 wrap item.
### Requirements
- [ ] R1. Wrap-up capture artifacts land at worktree-absolute paths — the wrapup-pipeline learning/metrics capture steps (and their dispatches) must use explicit worktree-absolute artifact paths and fail loudly (expectFile-style) when the capture file is missing after the agent step, instead of silently skipping the append.
### Acceptance Criteria
```gherkin
Scenario: a wrap-up capture artifact is always found where the append reads it
  Given a wrap-up learning/metrics capture step
  When the agent step finishes
  Then the artifact exists at the declared worktree-absolute path
  And a missing artifact fails the step with a named path rather than a silent skip
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Fix target: `.spur/workflows/wrapup-pipeline.yaml` learning-capture / metrics-record steps and the inline-pipeline-driver dispatch contract (`skills/sp-spur-dev/references/inline-pipeline-driver.md`) — resolve `answerFile` to an absolute worktree path before dispatch, and make the append shell verify existence (test -s) with a loud failure/skip message naming the path. Evidence: wrapup-pipeline.yaml `learning-capture` (agent.run input names `.spur/run/wrapup-learnings.md` relatively); the 17:22:43 empty-capture skip; the manual rewrite at 17:23:19.
Measurable target: run the wrap hop with a deliberately sandboxed capture and observe the append consuming the artifact from the worktree path.
### Plan
- [ ] 1. Harden wrapup-pipeline.yaml capture inputs to absolute worktree paths (or resolve at dispatch)
- [ ] 2. Make the append shell emit a named-path warning when the artifact is missing
- [ ] 3. Update inline-pipeline-driver dispatch contract: absolute answerFile paths for capture steps
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Evidence: .spur/workflows/wrapup-pipeline.yaml (learning-capture / metrics-record) · session 17:21:57-17:23:32 window
- Code: .spur/workflows/wrapup-pipeline.yaml · skills/sp-spur-dev/references/inline-pipeline-driver.md
- Report: docs/report/2026-08-14-E6-batch-forensic-report.md §4 wrap item
### History
