---
schema_version: 1
name: Persist the verify verdict artifact so wrap-up metrics survive worktree teardown
status: todo
template: feature-impl
created_at: 2026-09-28T08:31:25.123Z
updated_at: "2026-09-28T08:32:39.050Z"
feature_id: D62

ac_altitude: task-local
---

## 0994. Persist the verify verdict artifact so wrap-up metrics survive worktree teardown

### Background

Found during the 2026-09-28 `sp:dev-review-session --triage` of the 0981 → 0974 → 0970 → 0973 run.

`metrics-record` (`plugins/sp/scripts/wrapup-steps.ts:327-340`) derives a task's metric verdict by reading `.spur/run/<wbs>-verdict.json`, defaulting to `UNKNOWN`. `/sp-dev-run --worktree` FF-merges and removes the tree on success (WT-4/WT-5), so that gitignored artifact dies with the tree; `/sp-dev-wrap` then runs in the main tree where the artifact is absent.

0984 (done) persists worktree run evidence, but only the `.spur/run/<name>` anchors the task file *cites*, and `renderTesting` (`packages/app/src/services/task-record.ts`) emits source/command evidence plus a pathless `Verdict: PASS (from verdict artifact)` line — never a `.spur/run/…` citation for the verdict JSON. So the artifact is not persisted.

Observed on 0981: the wrap recorded `{"wbs":"0981",…,"verdict":"UNKNOWN"}` while the task's own verdict artifact read `PASS`; the later wraps only reported `PASS` because the artifact was copied into the main tree by hand before teardown.

AC altitude: task-local. These are regression checks on the wrap-up metrics path, not new feature ship criteria.

### Requirements

- [ ] R1. A completed task's metric verdict is derived from a source that survives worktree teardown — cite `.spur/run/<wbs>-verdict.json` from the recorded `Testing` section so 0984's persist-out copies it, or read the verdict from the tracked task record (F93's direction).
- [ ] R2. `metrics-record` must not record `verdict: "UNKNOWN"` for a task whose verdict artifact existed and was `PASS`/`PARTIAL`/`FAIL`. A genuinely missing artifact stays `UNKNOWN` but is named in the run record, not silently absorbed.
- [ ] R3. No change to the metrics row schema; existing `wrapup-metrics.jsonl` rows stay readable.
- [ ] R4. The fix holds for the documented two-command flow (`dev-run --worktree` then `dev-wrap`), not only for a wrap that runs inside the worktree.

### Acceptance Criteria

- [ ] AC1 — Metrics verdict survives teardown (req: R1, R2)
  - Verify: end-to-end `dev-run --worktree` on a PASS task, then `dev-wrap` in the main tree; the appended metrics row records `verdict: "PASS"`.
- [ ] AC2 — Absent verdict is honest (req: R2)
  - Verify: with the artifact removed in both trees the row is `UNKNOWN` and the run record names the missing file.
- [ ] AC3 — Schema unchanged (req: R3)
  - Verify: the existing metrics-row assertions in the wrapup tests still pass.
- [ ] AC4 — Repository gate (req: R1, R4)
  - Verify: `bun run spur-check` green, including the worktree-isolation and wrapup tests.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Two candidate mechanisms — pick one, keep the other as the absent-artifact path:

- **Cite it.** Add the `.spur/run/<wbs>-verdict.json` anchor to the `Testing` section `record` writes, so 0984's citation pass copies it before teardown. Smallest change; reuses the existing persist-out contract, whose cap and de-duplication (0984 R3) the added anchor must respect.
- **Read the task record.** Derive the metric verdict from the tracked `Testing` table (F93's "gate reads the tracked task record" direction) when the artifact is absent.

Rejected: reading the verdict inside the worktree during `dev-run` — `dev-run` is not the wrap producer, and it would couple two commands' responsibilities.

The honest-`UNKNOWN` requirement stays satisfied either way: when neither source exists, the row is `UNKNOWN` and the missing path is named in the run record.

### Plan

- [ ] Reproduce: run the two-command flow on a throwaway PASS task and confirm the `UNKNOWN` row.
- [ ] Add the failing assertion (metrics row reads `PASS`) to the wrapup test.
- [ ] Implement the chosen mechanism; keep the other as the absent-artifact path.
- [ ] Re-run the reproduction with the artifact removed to confirm the honest `UNKNOWN` plus the named file.
- [ ] Run `bun run spur-check`; commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.582Z backlog → todo (system)

