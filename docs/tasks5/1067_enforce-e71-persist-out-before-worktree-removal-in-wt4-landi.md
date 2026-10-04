---
schema_version: 1
name: enforce e71 persist out before worktree removal in wt4 landings
status: done
template: issue
created_at: 2026-10-03T04:25:11.012Z
updated_at: "2026-10-03T16:05:04.635Z"

feature_id: D3
priority: P3
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-d3-82ca7e3c/.spur/memory/evidence/1067-verdict.json
---

## 1067. enforce e71 persist out before worktree removal in wt4 landings

### Background

Surfaced 2026-10-02 during the manual WT-4 landing of runall-D63-2ebbd97c and its dogfood report (docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md, local).

**Gap 1 — E71 persist-out is documented but unenforced.** execution-batch.md:515 specifies that persist-out copies canonical task verdicts, feature receipts, and run artifacts from the worktree to the invoking tree before teardown. The actual landing of the D63 batch (manual shell execution of the runbook after the ancestry guard halted the first attempt) skipped persist-out: `git worktree remove` deleted the worktree's `.spur/memory/evidence/` copies of 1058-verdict.json, 1059-verdict.json, and the D63 feature-verification receipt. Impact was low only because a concurrent session had re-run feature verification on main — the loss was silent and discovered later. Nothing in the landing flow detects or blocks a removal that abandons unpersisted evidence.

**Gap 2 — task-diffstat silent artifact writer can be clobbered by its own stdout.** plugins/sp/scripts/task-diffstat.ts writes `.spur/run/<wbs>-diffstat.json` silently by design; piping or redirecting stdout over the artifact path clobbered it once during the 1059 triage hop (regenerated, no data loss). The script has no guard against this operator error.

Both are batch-landing tooling robustness gaps from the same dogfood, so they land as one task.

### Requirements

- [x] R1. WT-4 landing gains an enforcement point for E71 persist-out: before `git worktree remove`, compare the worktree's `.spur/memory/evidence/` (and `.spur/run/` verdict artifacts) against the invoking tree and warn-or-block with named files when anything would be abandoned. Smallest viable form: a driver-side checklist step or a pre-removal assertion script; no new public CLI verb.
- [x] R2. Document the skip-recovery in execution-batch.md WT-5: verdicts remain derivable from task records; feature receipts are re-runnable via the feature-verification workflow (`spur workflow run feature-verification.yaml --vars '{"featureId":"..."}'`).
- [x] R3. task-diffstat.ts refuses (nonzero exit, actionable message) when its stdout is redirected onto its own artifact path, or writes the artifact atomically after stdout flush so the clobber ordering cannot corrupt it. Normal invocation output stays silent; contract noted in the script header.
- [x] R4. Each change carries scratch-tree or fixture-level executable evidence: a landing without persist-out surfaces the warning; a redirected diffstat leaves the artifact intact.

### Acceptance Criteria

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/scripts/task-diffstat.ts:173` |
| `plugins/sp/scripts/task-diffstat.ts:177` |
| `plugins/sp/scripts/task-diffstat.ts:218` |
| `plugins/sp/scripts/task-diffstat.ts:22` |
| `plugins/sp/scripts/task-diffstat.ts:32` |
| `plugins/sp/tests/task-diffstat.test.ts:3` |
| `plugins/sp/tests/task-diffstat.test.ts:354` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/scripts/persist-out-check.ts (185 lines) exists; WT-4 pre-removal assertion wired at plugins/sp/skills/spur-dev/references/execution-batch.md:989-993 (re-read this run). |
| R2 | MET | WT-5 skip-recovery paragraph at execution-batch.md:1149 (re-read this run). |
| R3 | MET | task-diffstat stdout-redirect guard: atomic tmp+rename + fstat inode compare; redirect describe block green this run. |
| R4 | MET | bun test plugins/sp/tests/persist-out-check.test.ts plugins/sp/tests/task-diffstat.test.ts this run: 28 pass, 0 fail, 104 expect(). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | persist-out-check suite green this run (28 pass across both files) — blocked/ok/divergent cases covered. |
| AC2 | MET | test | Same run: persist-out-check + task-diffstat suites 28 pass, 0 fail. |
| AC3 | MET | test | Same run: stdout-redirect guard describe block green — artifact intact on redirect refusal. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Persist-out contract: plugins/sp/skills/spur-dev/references/execution-batch.md:515 (E71 durable planes); WT-4 create flow :884-1001; WT-5 :1123-1184.
- Landing session: runall-D63-2ebbd97c (marker .spur/run/worktree-2ebbd97c.json, status merged); recovery commits 00e1508c → 2039f5b90.
- diffstat script: plugins/sp/scripts/task-diffstat.ts (silent artifact-writer contract).
- Dogfood findings F4 + landing-retro: docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md (local, indexed in docs/dogfood/INDEX.md).

### History

- 2026-10-03T06:03:26.361Z todo → wip (system)
- 2026-10-03T06:37:17.803Z wip → testing (system)
- 2026-10-03T06:38:24.770Z testing → done (system)

