---
schema_version: 1
name: enforce e71 persist out before worktree removal in wt4 landings
status: wip
template: issue
created_at: 2026-10-03T04:25:11.012Z
updated_at: "2026-10-03T06:03:26.361Z"

feature_id: D3
priority: P3
ac_altitude: task-local
---

## 1067. enforce e71 persist out before worktree removal in wt4 landings

### Background

Surfaced 2026-10-02 during the manual WT-4 landing of runall-D63-2ebbd97c and its dogfood report (docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md, local).

**Gap 1 — E71 persist-out is documented but unenforced.** execution-batch.md:515 specifies that persist-out copies canonical task verdicts, feature receipts, and run artifacts from the worktree to the invoking tree before teardown. The actual landing of the D63 batch (manual shell execution of the runbook after the ancestry guard halted the first attempt) skipped persist-out: `git worktree remove` deleted the worktree's `.spur/memory/evidence/` copies of 1058-verdict.json, 1059-verdict.json, and the D63 feature-verification receipt. Impact was low only because a concurrent session had re-run feature verification on main — the loss was silent and discovered later. Nothing in the landing flow detects or blocks a removal that abandons unpersisted evidence.

**Gap 2 — task-diffstat silent artifact writer can be clobbered by its own stdout.** plugins/sp/scripts/task-diffstat.ts writes `.spur/run/<wbs>-diffstat.json` silently by design; piping or redirecting stdout over the artifact path clobbered it once during the 1059 triage hop (regenerated, no data loss). The script has no guard against this operator error.

Both are batch-landing tooling robustness gaps from the same dogfood, so they land as one task.

### Requirements

- [ ] R1. WT-4 landing gains an enforcement point for E71 persist-out: before `git worktree remove`, compare the worktree's `.spur/memory/evidence/` (and `.spur/run/` verdict artifacts) against the invoking tree and warn-or-block with named files when anything would be abandoned. Smallest viable form: a driver-side checklist step or a pre-removal assertion script; no new public CLI verb.
- [ ] R2. Document the skip-recovery in execution-batch.md WT-5: verdicts remain derivable from task records; feature receipts are re-runnable via the feature-verification workflow (`spur workflow run feature-verification.yaml --vars '{"featureId":"..."}'`).
- [ ] R3. task-diffstat.ts refuses (nonzero exit, actionable message) when its stdout is redirected onto its own artifact path, or writes the artifact atomically after stdout flush so the clobber ordering cannot corrupt it. Normal invocation output stays silent; contract noted in the script header.
- [ ] R4. Each change carries scratch-tree or fixture-level executable evidence: a landing without persist-out surfaces the warning; a redirected diffstat leaves the artifact intact.

### Acceptance Criteria

- [ ] AC1 — A landing executed without persist-out surfaces a named warning/block listing the at-risk evidence files before worktree removal. (req: R1)
- [ ] AC2 — WT-5 recovery text documents the receipt re-run path. (req: R2)
- [ ] AC3 — Redirecting task-diffstat stdout over its artifact leaves the artifact intact and exits nonzero; normal runs unchanged. (req: R3)
- [ ] AC4 — Executable evidence exists for both behaviors; suites green. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Persist-out contract: plugins/sp/skills/spur-dev/references/execution-batch.md:515 (E71 durable planes); WT-4 create flow :884-1001; WT-5 :1123-1184.
- Landing session: runall-D63-2ebbd97c (marker .spur/run/worktree-2ebbd97c.json, status merged); recovery commits 00e1508c → 2039f5b90.
- diffstat script: plugins/sp/scripts/task-diffstat.ts (silent artifact-writer contract).
- Dogfood findings F4 + landing-retro: docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md (local, indexed in docs/dogfood/INDEX.md).

### History

- 2026-10-03T06:03:26.361Z todo → wip (system)

