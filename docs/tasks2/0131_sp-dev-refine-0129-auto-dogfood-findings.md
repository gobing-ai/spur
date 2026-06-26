---
schema_version: 1
name: "/sp:dev-refine 0129 --auto dogfood findings"
description: ""
status: backlog
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-26T19:14:43.613Z"
updated_at: 2026-06-26T19:15:14.600Z
---

## 0131. /sp:dev-refine 0129 --auto dogfood findings

### Background
#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | `ts-ai-runner` capture layer + `sp:spur-dev` refine op | `/sp:dev-refine --auto` depends on `spur agent run` capturing an agentic (tool-using) agent's output, but it is not surfaced: `omp` returns empty stdout on multi-step tool prompts (simple `--mode text` works), `claude` times out on cold-start (exit 143). Refine's core synthesis silently no-ops (exit 0, no section written, no skip-report) | (1) Surface the agentic/tool transcript in `spur agent run`; (2) treat empty synthesis output as a hard failure with a clear message; (3) document supported agents/modes for `--auto` |
| P2 | `sp:spur-dev` refine op | No feedback when synthesis produces nothing — planning-workflow.md:172 promises a report under `--auto`, but empty output yields no report; operator can't tell skip-from-broke | Emit a structured refine result (sections-considered / written / reason) even on no-op |
| P2 | `task check` L3 rule | "Plan should be ordered checklist" fires on `0129` though its Plan IS a checklist (`**Phase A — …:**` headers + `- [ ] A1.` items); checker doesn't recognize bold-phase-header + checkbox form | Teach the L3 Plan check to recognize `**<heading>**` phases containing `- [ ]` items as valid ordered form |
| P2 | `sp:spur-dev` refine op | No "already-well-specified → skip gracefully" branch: `0129` had operator-confirmed Design+Plan yet `--auto` still tried to synthesize | Add a pre-synthesis quality gate — if `task check` PASS and sections already meet L3 structure, emit SKIP with reason instead of invoking the agent |
| P3 | (context-window) | Low cache hit rate (~44% aggregate; synthesis steps ~25–27%); failed omp/claude invocations each resent full prompt scaffolding | Batch gap-analysis + synthesis prompt; reuse read-task context across retries |

Source: `docs/dogfood/2026-06-26-dev-refine-0129-auto-dogfood.md`
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Re-review the changed code

### Review
Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Priority | Status | Note |
|----------|--------|------|
| P1 | TODO | (filled after first fix round) |
| P2 | TODO | (filled after first fix round) |
### References

### History
