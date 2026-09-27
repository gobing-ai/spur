---
schema_version: 1
name: Order the residual-sweep box check against the record-stage box flip
status: todo
template: feature-impl
created_at: 2026-09-27T07:11:28.202Z
updated_at: "2026-09-27T16:46:44.115Z"
feature_id: F96

ac_altitude: task-local
dependencies: ["0958"]
priority: P1
estimate_hours: 4
---

## 0983. Order the residual-sweep box check against the record-stage box flip

### Background

Found during `/sp:dev-run 0967 --auto --next --agent inline --worktree` (run `20445c34-e98e-4928-a30a-a6746f503be3`).

**Symptom.** The `verify` state's residual sweep folded the verdict `PASS` → `PARTIAL` with `blocking=13 deferrable=0`, all 13 items category `unchecked-box`: the task's 5 Requirement boxes, 2 AC boxes and 6 Plan boxes. That downgrade makes the `record → done` guard (`jq -r .verdict … == "PASS"`) unreachable, so the run cannot complete on the normal path.

**Root cause — the fold and the box flip are ordered the wrong way round.**

- `plugins/sp/scripts/residual-scan.ts:318` — `findUncheckedBoxes(taskContent)` scans the **whole** task file; there is no section exemption.
- `plugins/sp/scripts/residual-scan.ts:290` — the deferral exemption deliberately excludes `unchecked-box` (`item.category !== 'unchecked-box'`), so an unchecked box can never be deferred by a `residual-deferrals.json` entry.
- `plugins/sp/scripts/residual-scan.ts:410` — `foldVerdict` downgrades `PASS` → `PARTIAL` whenever `blocking.length > 0`.
- `packages/app/src/services/task-record.ts:189` — `flipVerifiedCheckboxes` (the verdict-driven `[ ]` → `[x]` flip, R2 task 0692) runs inside the **`record`** state.
- `config/workflows/task-pipeline.yaml` — `record` runs after `verify`, and its `record → done` guard requires a `PASS` verdict artifact.

So on the first pass — and on every pass — verify folds `PARTIAL` on a task whose Requirement/AC boxes are still unticked, while the only component that flips them runs afterwards. The verdict artifact already proves those rows (`MET`), so the boxes are *record-owned*, not unresolved work.

**Observed recovery (hand-certification, 4m45s of extra gate time).** Ticked the 13 boxes via `spur task update --section …`, re-captured the proof digest with `inline-run-setup.ts --fingerprint`, re-ran the full gate (`bun run spur-check`, 4m45s), re-ran `residual-scan scan|fold`, then re-bound the verdict with the verify state's `jq` proof block.

**Second-order cost (measured).** The Requirement/AC/Plan boxes are **inside** the proof-input scope: the certified digest moved `sha256:ac78bd41…` → `sha256:d5a73aa2…` purely from box flips, invalidating the gate receipt and forcing the gate to re-run. `## Review` / `## Testing` / `## Solution` writes do *not* move the digest (verified in the same run).

Related prior work: 0949 (scanner modes), 0950 (sweep wired into task-pipeline), 0951 (standalone verify + C6 recovery), 0977 (placeholder review rows).

**Refine corrections (2026-09-27)**

- The verdict can prove Requirement/AC boxes, but the six Plan boxes in the 0967 failure are not record-owned and must remain blockers until completed.
- The scanner runs before record; the corrected design moves the existing scan after record rather than deferring unchecked boxes by section.

### Requirements

- [ ] R1. The residual sweep evaluates unchecked boxes after the record stage has applied the verdict-driven Requirement/AC flips. A PASS verdict with all other boxes completed reaches the normal done guard without hand-certification.
- [ ] R2. Any box still unchecked after record, including an unproven Requirement/AC box or an unfinished Plan box, remains blocking; none becomes deferrable by section alone.
- [ ] R3. The reordered sweep can downgrade the verdict before `record → done`, preserving the fail-closed completion gate and its proof checks.
- [ ] R4. A regression test covers both the proven-box pass path and an unproven/Plan-box fail path.
- [ ] R5. If the post-record sweep downgrades the verdict, the task's Testing section reflects that final verdict before the run exits.

### Acceptance Criteria

- [ ] AC1 — Verdict-proven Requirement/AC boxes are flipped before the sweep and do not block (req: R1)
- [ ] AC2 — Unproven Requirement/AC and unfinished Plan boxes still block the done hop (req: R2, R3)
- [ ] AC3 — Pipeline order and both outcomes have regression coverage (req: R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Move the existing `residual-scan scan|fold` action from verify to record, immediately after `task record` flips verdict-proven Requirement/AC boxes and before `record → done` evaluates the verdict. Keep `findUncheckedBoxes` and its blocking classification unchanged: the scan reads the actual post-record task file, so it needs no duplicate proof matcher or section-wide exemption. The `record → done` guard already requires PASS and `task check --as done`, and the existing failed edge handles a downgraded verdict.

This task depends on 0958's checkbox-canonical proof fingerprint: record-time flips must not invalidate the registered proof. Plan boxes are not flipped by `task record`; they must be completed before verification or remain a valid blocker. The 0967 run's six unchecked Plan boxes were a separate unfinished-work condition. Update the residual-sweep design satellite as the rule owner.
If the fold changes PASS to PARTIAL, re-record the task's Testing section from the final artifact before taking the failed edge; a failed task must not retain a stale PASS Testing narrative.

### Plan

- [ ] Confirm the current verify and record action order and the existing record-to-done guard.
- [ ] Move the scanner's scan/fold action after `task record` in the record state; leave its classification unchanged.
- [ ] Cover a PASS verdict with proven R/AC boxes and already-complete Plan, plus unproven R/AC and open Plan cases; assert a downgraded verdict is re-recorded in Testing.
- [ ] Update the residual-sweep design satellite, run focused tests and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Not yet implemented — capture only.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T07:12:01.260Z backlog → todo (system)

