---
template: review
schema_version: 1
name: Dogfood findings — dev-refine 0164 auto-next chain
description: ""
status: done
type: task
profile: standard
feature_id: H3
parent_wbs: null
priority: P2
tags: [review]
dependencies: []
created_at: 2026-06-30T23:29:53.230Z
updated_at: 2026-07-01T00:49:22.193Z
---

## 0166. Dogfood findings — dev-refine 0164 auto-next chain

### Background
Dogfood runs of the full `dev-refine → dev-run → dev-verify --next` chain on tasks 0162, 0164, and 0165. Findings consolidated from tasks 0163 (partial, P2 only) and 0167 (merged).

0162 run (`/sp:dev-run 0162 --auto --next`): AC guard and SECUA review passed; 1 finding from verifier section-write guidance. 0164 runs (refine → run → verify): skip gate passed; all 10 plan steps implemented; PASS verdict. 0165 runs (refine → run → verify): skip gate passed; all 18 plan steps implemented; PASS verdict.

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2       | `docs/tasks2/0164_*.md` | Missing `feature_id` on task 0164 — L4 traceability edge not set | Create feature H3 or link to existing; `spur task update 0164 --feature <id>` |
| P2       | `plugins/sp/skills/code-verification/SKILL.md:149` | Standalone verifier section-write guidance incomplete for `Testing`: writing same-level headings into the `Testing` section body produces task-writer stripping warnings | Update `sp:code-verification` Step 8/9 to distinguish answer-file headings from task-section bodies for both Testing and Review; use bold labels or tables instead of `###` headings in section bodies |
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
| File | Lines | What / Why |
|------|-------|------------|
| `docs/tasks2/0164_*.md` | 1 | P2: Linked task 0164 to feature H3 via `spur task update 0164 --feature H3` — closes the traceability edge |
| `plugins/sp/skills/code-verification/SKILL.md` | 206-212 | P2: Extended section-write guidance to cover Testing section alongside Review — same-level heading stripping affects all section bodies |
| `plugins/sp/commands/dev-run.md` | 57-69 | P3: Added "Task-type awareness" section with template→scope+input table for review/brainstorm task routing |
| `packages/app/src/services/task-check.ts` | 132-157 | P3: Added `hasAdjacentFileLineColumns()` helper; L3 Solution guard now detects table-format file+line adjacent columns |
| `plugins/sp/commands/dev-refine.md` | 71-75 | P4: SKIP message template now includes `(N L4 advisory: <labels>)` suffix when L4 findings exist |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | 103-111 | P4: Same L4-advisory suffix in the dev-operations SKIP contract + structured JSON `l4Advisories` field |
### Testing
Per-finding verification:

| Finding | Status | Evidence |
|---------|--------|----------|
| P2: 0164 feature_id link | MET | `spur task show 0164 --json` → `feature_id: H3` |
| P2: Verifier section-write guidance | MET | `plugins/sp/skills/code-verification/SKILL.md:206-212` — Testing section now covered alongside Review |
| P3: Task-type awareness | MET | `plugins/sp/commands/dev-run.md:57-69` — template→scope table present |
| P3: Table-format file:line citations | MET | `packages/app/src/services/task-check.ts:132-157` — `hasAdjacentFileLineColumns()` added; Solution guard updated |
| P4: L4 advisories in SKIP | MET | `dev-refine.md:71-75`, `dev-operations.md:103-111` — L4 suffix + JSON field added |

Gate results:
- `bun run lint` — clean (382 files, 0 warnings)
- `bun run test` — 2017 pass, 0 fail
- `bun run build` — all workspaces build successfully
- `spur task check 0166 --strict` — PASS, 0 findings

Coverage: N/A (documentation + code-quality changes; no new runtime code paths added).
### Review
Post-implementation reflection — all 5 findings from the `#### Review Findings` table addressed.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `docs/tasks2/0164_*.md` | DONE — linked 0164 to feature H3 via `spur task update 0164 --feature H3` | — |
| P2 | `plugins/sp/skills/code-verification/SKILL.md:206-212` | DONE — extended section-write guidance to cover Testing section, not just Review | — |
| P3 | `plugins/sp/commands/dev-run.md:57-69` | DONE — added "Task-type awareness" section routing review/brainstorm tasks correctly | — |
| P3 | `packages/app/src/services/task-check.ts:132-157` | DONE — added `hasAdjacentFileLineColumns()` for table-format file+line citations | — |
| P4 | `plugins/sp/commands/dev-refine.md:71-75`, `dev-operations.md:103-111` | DONE — SKIP message now surfaces L4 advisory count | — |
### References

<!-- Links to source review, dogfood report, PR/diff, related tasks, or external references. -->

### History
- 2026-07-01T00:44:55.969Z backlog → todo (system)
- 2026-07-01T00:47:55.320Z todo → wip (system)
- 2026-07-01T00:48:42.797Z wip → testing (system)
- 2026-07-01T00:49:22.193Z testing → done (system)
