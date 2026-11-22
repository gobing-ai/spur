---
schema_version: 1
name: Reconcile feature status drift through the feature tool
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:33.159Z
updated_at: "2026-11-22T04:08:46.586Z"
feature_id: A83

tags: ["A83"]
priority: P2
estimate_hours: 4
---

## 1429. Reconcile feature status drift through the feature tool

### Background

Implements: R5 — Feature status drift is reconciled through the feature tool.

Evidence source: `spur feature sync --all --dry-run --json`.

**Refine corrections (2026-11-21)**
- "44 receipt-pending + G8" → a re-run today reports **19** proposals with `from ≠ to` (230 features, 224 evaluated):
  - G8 `active → blocked` ("All non-terminal linked tasks are blocked").
  - 18 `→ verifying` with `receiptPending: true`:
    - missing receipt: E2, E94, F8, F21, F22, G1, G63, H51, K3, I14 (backlog);
    - stale receipt: B6, E5, E6, H16, K4;
    - failed receipt: F43, R (backlog);
    - run receipt: F7.

  The number moves as receipts land, so the task works from a fresh dry-run, not a frozen list.
- "`spur feature verify <id>` when the tree supports it" → verify runs the selected definition's command, which is `bun run spur-check-feature` (`packages/app/src/services/sdlc-actions.ts:37`): a **repo-wide** pass including `test:heavy`. The receipt digest binds tree + feature spec + learnings + check contract (`L4.feature-receipt-stale` message), so one pass cannot serve two features. 18 receipts means 18 full passes.
- A FAIL receipt is legitimate evidence: the feature parks at `verifying` with a failed receipt, which is honest. "Verify" does not mean "force to done".
- The Notes route exists: features carry `## Notes` (e.g. G8), written with `spur feature update <id> --section Notes --from-file <f>`.
- `mutationPolicy: none` for source. The deliverable is corpus state plus receipts, and no `apps/`/`packages/` diff is expected.

### Requirements

- [ ] R1. Apply the status-only proposal G8 `active → blocked` with `spur feature sync G8`.
- [ ] R2. Each `receiptPending` feature in a fresh dry-run gets exactly one of the following:
  - (a) `spur feature verify <id>` run on a clean committed tree, then `spur feature sync <id>`; or
  - (b) a dated `## Notes` entry via `spur feature update --section Notes` saying why it is deferred (e.g. its tasks are unfinished in spirit, or the spec needs refresh first), with the follow-up named.
- [ ] R3. No status is set with `spur feature update <id> <status>` or a file edit to get around the L4 receipt gate.
- [ ] R4. Evidence in this task's Solution: the dry-run counts before and after, and per feature the action, the receipt verdict (PASS/FAIL) and the resulting status.

Out of scope: fixing the code behind a FAIL receipt (file a task instead), changing the L4 gate or digest inputs, and features not reported by the dry-run.

### Acceptance Criteria

- [ ] AC1 — Feature status drift is reconciled through the feature tool

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:08:46.204Z

- **Closed: FAIL receipts.** Record them, don't hide them. A feature parked at `verifying` with a failed receipt is the truthful state, and the follow-up fix is filed as a task.
- **Closed: sandbox runs.** Defer with a Notes reason rather than record an environmental FAIL, because such a receipt would mislead the next reader.

### Design

- **Order:**
  1. `spur feature sync G8` (cheap; no receipt).
  2. Triage the 18 from `gateFindings` codes. `stale` and `run` are the cheapest to make PASS, because earlier evidence existed. `missing` may hide real gaps, so read the feature's tasks first. `failed` means rerun only after reading the last receipt's failure.
  3. Verify sequentially, one feature per pass, on a committed tree that is clean of other tasks' changes. The digest includes the tree, so any edit between passes stales the earlier receipts.
  4. Run `spur feature sync --all` once at the end.
- **Execution budget:** a full `spur-check-feature` is about one repo-wide test pass plus heavy tests. Budget 18 passes and checkpoint after each. Persist the per-feature row (id, receipt verdict, status) in Solution as it lands, so an interrupted run resumes at the next id instead of rerunning.
- **Environment:** run the passes where the gate is green. This sandbox blocks `.git/worktrees` writes and fails 3 workflow tests, which would record FAIL receipts for environmental reasons. If verify must run here, choose option (b) with that reason instead of recording a misleading FAIL.
- **Anti-patterns:** no `feature update <id> done`; no batching several features into one pass; no edits between passes; no new verify flags.
- **Independent of 1426–1428 and 1430.** It can run any time the tree is quiescent. Running it after them avoids staling their receipts.

### Plan

- [ ] 1. `spur feature sync --all --dry-run --json > .spur/run/1429-before.json`. Record the count of `from ≠ to` and the list.
- [ ] 2. `spur feature sync G8 --json`, then confirm G8 is `blocked` in a re-run dry-run.
- [ ] 3. For each receipt-pending id: read `spur feature show <id> --json` and its last receipt. Choose verify or a Notes deferral per Design. For verify: `spur feature verify <id>` → `spur feature sync <id> --json`. Append the row to Solution immediately.
- [ ] 4. `spur feature sync --all --json` → `spur feature sync --all --dry-run --json > .spur/run/1429-after.json`. Record both counts in Solution. Every remaining `from ≠ to` entry must have a Notes reason.
- [ ] 5. `spur feature refresh`, then `git status --short` (only `docs/features/**` and receipts should change).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:13.298Z backlog → todo (system)

