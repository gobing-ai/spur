---
schema_version: 1
name: "sp-dev-run 0158 auto next dogfood findings"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-30T04:53:07.654Z"
updated_at: 2026-06-30T05:08:58.808Z
---

## 0160. sp-dev-run 0158 auto next dogfood findings

### Background
#### Review Findings

Dogfood run: `sp-dev-run 0158 --auto --next` via `sp-dev-dogfood --save --task --full`.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `plugins/sp/skills/code-verification/SKILL.md:183` | The verify skill requires `### SECUA Review` in the answer-file format, but standalone section writes that include the same heading are stripped by `spur task update` as a phantom-section guard. | Clarify that `### SECUA Review` is required only in the captured answer file; task `Review` section bodies should use a table or bold label instead. |
| P3 | `plugins/sp/skills/code-verification/SKILL.md` | Docs-only verification needed an explicit `Coverage: N/A` line to satisfy the task checker; the verify guidance does not call out this docs-only convention. | Add a docs/config-only example that writes `Coverage: N/A (<reason>)` in `Testing` when no runtime coverage applies. |
| P3 | `sp-dev-dogfood` monitor discipline | The implementation step had low cache locality because it needed fresh rd3 source reads and new reference authoring. | Keep no code task unless this repeats; consider a shorter PM-migration extraction checklist if future rd3 absorption tasks are common. |
| P4 | `plugins/sp/skills/spur-dev/references/product-planning.md:14` | The new reference intentionally mentions rejected legacy terms (`rd3:product-management`, `ftree`, `prd-*`), so broad stale-surface greps produce expected hits. | For future migration tasks, pair broad grep with a second live-surface grep over `plugins/sp/commands` and `plugins/sp/agents`. |
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

| File | What / why |
| --- | --- |
| `plugins/sp/skills/code-verification/SKILL.md:157` | Clarified that `Review` section bodies must be body-only and should not include same-level `### SECUA Review` headings. |
| `plugins/sp/skills/code-verification/SKILL.md:193` | Distinguished the pipeline answer-file `### SECUA Review` contract from standalone task section writes. |
| `plugins/sp/skills/code-verification/SKILL.md:219` | Added a docs/config-only verification convention: `Coverage: N/A (<reason>)`. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:120` | Added a migration grep rule so broad legacy-term greps are paired with live command/agent surface checks before filing stale-routing findings. |

### Testing

Verdict: PASS

Coverage: N/A (documentation-only skill guidance change; no runtime code path added).

| Req | Status | Evidence |
| --- | --- | --- |
| P2. Clarify `### SECUA Review` answer-file vs section-body guidance. | MET | `plugins/sp/skills/code-verification/SKILL.md:158` documents body-only Review writes; `plugins/sp/skills/code-verification/SKILL.md:193` marks the heading as answer-file-only. |
| P3. Add docs-only `Coverage: N/A` verify convention. | MET | `plugins/sp/skills/code-verification/SKILL.md:223` provides the explicit N/A line. |
| P4. Pair broad migration grep with live-surface grep. | MET | `plugins/sp/skills/dogfood-testing/references/report-template.md:120` adds the migration grep rule. |
| P3. Cache-locality observation. | MET | Closed as observational/unverifiable for this task; no repeated cache issue in this run. |

Checks:

| Check | Status | Evidence |
| --- | --- | --- |
| `biome check plugins/sp` | pass | Checked 7 files; no fixes applied. |
| `bun test plugins/sp` | pass | 65 pass, 0 fail. |
| `rg -n "body-only\|answer-file contract only\|Coverage: N/A\|Migration grep rule" ...` | pass | Found all expected guidance anchors. |

### Review
| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | — | No blocker findings. | No action required. |
| P2 | `plugins/sp/skills/code-verification/SKILL.md:157` | The answer-file `### SECUA Review` contract could be misapplied to task Review section bodies. | DONE — clarified body-only section writes and answer-file-only heading usage. |
| P3 | `plugins/sp/skills/code-verification/SKILL.md:219` | Docs-only verification lacked an explicit coverage N/A convention. | DONE — added the `Coverage: N/A (<reason>)` convention. |
| P3 | `plugins/sp/skills/dogfood-testing/references/report-template.md:120` | Migration greps can confuse intentional legacy-term rejection notes with live routed surfaces. | DONE — added the broad-grep plus live-surface-grep rule. |
| P4 | — | Cache-locality note was observational and not actionable for this task. | CLOSED — no code/doc change; no repeat signal in this run. |
### References

### History
- 2026-06-30T05:06:16.916Z backlog → todo (system)
- 2026-06-30T05:07:37.282Z todo → wip (system)
- 2026-06-30T05:08:11.626Z wip → testing (system)
- 2026-06-30T05:08:58.808Z testing → done (system)
