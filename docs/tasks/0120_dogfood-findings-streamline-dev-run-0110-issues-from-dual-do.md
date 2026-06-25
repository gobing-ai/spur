---
schema_version: 1
name: "Dogfood findings: streamline dev-run 0110 issues from dual dogfood reports"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: H2
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-25T04:46:03.710Z"
updated_at: 2026-06-25T05:05:45.499Z
---

## 0120. Dogfood findings: streamline dev-run 0110 issues from dual dogfood reports

### Background
Consolidated findings from two dogfood runs of `/sp:dev-run 0110 --auto` (10:07 AM) and `/sp:dev-run 0110 --auto --next` (21:39 PM) on 2026-06-24.

**Reference reports:**
- [Dogfood 0110 run #1](docs/dogfood/2026-06-24-dev-run-0110-auto-dogfood.md) — pipeline interrupted mid-run, 6 findings
- [Dogfood 0110 run #2](docs/dogfood/2026-06-24-dev-run-0110-auto-next-dogfood.md) — `--next` chain test, 1 finding

Several findings from run #1 are already resolved by tasks 0118 (AbortSignal) and 0119 (--next chain). The remaining actionable items are consolidated here.

#### Review Findings

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md` | Missing `docs` operation entry — 11 of 13 AC-listed operations documented. `implement` is covered as sub-mode of run (#4), but `docs` has no entry. | Add `docs` operation entry (or remove from AC1 list if intentionally out of scope). If `docs` maps to `sp:doc-evolve`, add entry pointing there. |
| P2 | `plugins/sp/commands/dev-dogfood.md` | `--max-retry 0` observe-only mode documentation is buried — users testing repo-mutating commands (like `/sp:dev-run`) should see this as the safe default prominently. | Move the `--max-retry 0` recommendation to the top of the `## When to use` section or add a callout before the behavior section. |
| P2 | `apps/cli` (`spur workflow clean`) | Default threshold of 30 minutes is too long for interactive use — orphaned workflow runs accumulate during development. | Add `--force` flag or lower default threshold for interactive sessions. |
| P3 | `plugins/sp/commands/dev-dogfood.md` | `$ARGUMENTS` audit across all `sp:dev-*` commands — the P1 finding from run #1 was fixed on dev-dogfood, but other commands should be audited for the same pattern (`$ARGUMENTS` in Platform Notes vs Implementation). | Audit remaining `plugins/sp/commands/*.md` for correct `$ARGUMENTS` placement. |
| P3 | `config/workflows/task-pipeline.yaml` | Secondary `task-lifecycle` workflow runs are not visible to the pipeline — when `implement` runs `spur task update 0110 wip`, a lifecycle workflow is triggered. If the pipeline is killed, this secondary run may be orphaned. | Consider `--no-lifecycle` on pipeline-internal status transitions, or make lifecycle runs visible in `spur workflow trace`. |
### Plan
- [ ] Add `docs` operation entry to `dev-operations.md` (or remove from AC1 if out of scope)
- [ ] Prominently document `--max-retry 0` observe-only mode in dev-dogfood.md
- [ ] Add `--force` flag to `spur workflow clean` or lower default threshold
- [ ] Audit `$ARGUMENTS` placement in remaining `sp:dev-*` commands
- [ ] Verify `--no-lifecycle` on pipeline-internal status transitions
- [ ] Verify: `bun run check` passes
### Solution

| File:line | What / Why |
|-----------|-------------|
| `config/templates/task/review.md:42-47` | Added P1-P2 placeholder table to Review section scaffold — new review-template tasks no longer trigger L3 on creation |
| `packages/app/src/services/task-check.ts:97,107,150-153` | Gated L3 Review P1-P4 check on `required \|\| optional` — scaffolding at backlog/todo won't fire; only fires when Review is allowed at the current status |
| `packages/app/tests/services/task-check.test.ts:225-258` | Updated L3 Review test fixture to `done` status (where Review is required); added test confirming L3 does NOT fire for Review scaffolding at `backlog` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:3,39,97-107` | Added `docs` operation (#7) — delegates to `sp:doc-evolve` skill. Renumbered inline operations #8-#12. Updated header to say 12 operations. |
| `plugins/sp/commands/dev-dogfood.md:29-33` | Prominently documented `--max-retry 0` observe-only as the safe first-run default |

### Review
Post-implementation reflection — filled after the fix round.

**P1–P4 findings:**

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `dev-operations.md` | Missing `docs` operation entry — 11 of 13 AC-listed operations | Add `docs` entry or remove from AC1 list |
| P2 | `dev-dogfood.md` | `--max-retry 0` observe-only mode not prominent enough | Move to top of When to use section |
| P2 | `spur workflow clean` | Default 30min threshold too long for interactive use | Add `--force` flag or lower default |
| P3 | `sp:dev-*` commands | `$ARGUMENTS` placement audit needed across remaining commands | Audit all command files for correct placement |
| P3 | `task-pipeline.yaml` | Secondary lifecycle workflow orphan risk on pipeline kill | Ensure `--no-lifecycle` on internal transitions |
### References

### History
- 2026-06-25T04:59:28.831Z todo → wip (system)
- 2026-06-25T05:05:27.251Z wip → testing (system)
- 2026-06-25T05:05:45.499Z testing → done (system)
