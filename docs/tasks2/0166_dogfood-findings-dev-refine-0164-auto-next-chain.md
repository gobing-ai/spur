---
template: review
schema_version: 1
name: "Dogfood findings — dev-refine 0164 auto-next chain"
description: ""
status: backlog
type: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-30T23:29:53.230Z"
updated_at: "2026-06-30T23:41:15.833Z"
---

## 0166. Dogfood findings — dev-refine 0164 auto-next chain

### Background
Dogfood runs of the full `dev-refine → dev-run → dev-verify --next` chain on task 0164. Three runs, three reports, findings consolidated here.

Refine run (`/sp:dev-refine 0164 --auto --next`): skip gate passed correctly; `--next` chain to dev-run identified. Run (`/sp:dev-run 0164 --auto --next`): all 10 plan steps implemented (parallel-execution skill, fan-out patterns, result synthesis, dev-parallel command, super-coder agent, execution-batch section, R24 test invariant, README update); 1 fix needed for L3 Solution file:line format. Verify (`/sp:dev-verify 0164 --auto --next`): PASS verdict (10/10 reqs, 6/6 AC); recorded and transitioned to done.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2       | `docs/tasks2/0164_*.md` | Missing `feature_id` on task 0164 — L4 traceability edge not set | Create feature H3 or link to existing; `spur task update 0164 --feature <id>` |
| P3       | `plugins/sp/commands/dev-run.md` | Pipeline assumes code-implementation tasks; no task-type hint for plugin-authorship tasks | Spine could classify task type from template/tags and surface hint to implement step |
| P3       | `packages/app/src/services/task-check.ts` | L3 Solution guard requires literal `file:line` pattern; table-format `file` + `line` columns not recognized | Enhance L3 Solution check to also accept markdown table rows with adjacent `file` and `line` columns as valid citations |
| P4       | `plugins/sp/commands/dev-refine.md` | L4 warnings not surfaced in `--auto` SKIP message | Include L4 advisory count: `SKIP — sections already meet L3 ... (1 L4 advisory: missing feature_id)` |
### Requirements

<!-- R-numbered fix requirements derived from the findings. Fill after triage/refinement. -->

### Acceptance Criteria

<!-- Checks that prove the findings were addressed. Keep empty until the review task becomes executable work. -->

### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design

<!-- Fix approach and tradeoffs if the findings require design judgment. -->

### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### References

<!-- Links to source review, dogfood report, PR/diff, related tasks, or external references. -->

### History
