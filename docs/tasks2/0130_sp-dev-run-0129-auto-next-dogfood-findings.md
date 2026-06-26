---
schema_version: 1
name: "/sp:dev-run 0129 --auto --next dogfood findings"
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
created_at: "2026-06-26T18:53:42.741Z"
updated_at: 2026-06-26T18:59:18.880Z
---

## 0130. /sp:dev-run 0129 --auto --next dogfood findings

### Background
#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | `plugins/sp/commands/dev-dogfood.md` | `/sp:dev-dogfood` defaults to `--max-retry 2` (mutating) and this testee in full mode launches a real, mutating, multi-hour pipeline against a live task with no programmatic halt; nothing enforces the skill's own "observe-only first" (Gotcha #1) | Default `dev-dogfood` to `--max-retry 0` for pipeline-driving testees, OR have `sp:spur-dev run` refuse a non-dry-run launch under `DOGFOOD=1` without `--confirm-execute` |
| P1 | `plugins/sp/skills/spur-dev/references/execution-workflow.md:93` | `--next` is silently ignored in full mode; the warning is skill prose an agent may omit, not a deterministic emission | Emit the `--next`-ignored warning from the CLI/harness itself, not from agent-remembered prose |
| P2 | `config/workflows/task-pipeline.yaml:64` | `implement` transitions `backlog→wip` via `--no-lifecycle` before the agent writes any code; a halted run leaves `wip` with no Solution (half-state) | Move the status transition to after implement `agent.run` succeeds, or record a rollback marker |
| P2 | review task template | `### Review` ships empty prose scaffold with no P1–P4 table → `spur task create --template review` fails its own L3 check on creation; every new review task must be hand-patched | Add the placeholder P-table to the `### Review` section of the review template scaffold |
| P3 | `apps/cli/src/commands/workflow.ts` | No dedicated stop verb; operator must know `clean --older-than 0`/`--force` is the cancel path, and `clean`'s help frames it as "orphaned runs" so live-cancel is non-obvious | Add `spur workflow cancel <run-id>` (discoverable + signals AiRunner to kill in-flight subprocess), or reframe `clean`'s help to surface the cancel use case |
| P3 | (context-window) | Low cache hit rate (~46% aggregate; steps 3–7 under 40%) when driving `dev-run` programmatically | Batch precheck+dry-run+launch probes; trim prompt scaffolding between steps |

Source: `docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md`
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
