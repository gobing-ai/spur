---
schema_version: 1
name: Guard WBS allocation against cross-checkout collisions in concurrent batch runs
status: cancelled
template: feature-impl
created_at: 2026-10-01T00:47:13.093Z
updated_at: "2026-10-01T07:09:38.771Z"
feature_id: A9

---

## 1036. Guard WBS allocation against cross-checkout collisions in concurrent batch runs

### Background

Captured from the creation title: "Guard WBS allocation against cross-checkout collisions in concurrent batch runs".

### Requirements

Cancellation audit 2026-09-30: N/A for delivery verification. Task remains cancelled; the operator has not reactivated the withdrawn proposal. Unticked proposal checkboxes are rendered as historical bullets to avoid suggesting pending delivery work.

- **R1.** Withdrawn proposal: Background: during batch runall-A9-485e, a concurrent agent session in a sibling checkout (i33) allocated overlapping WBS numbers, producing duplicate task IDs (1015/1021-1023 era) that had to be reconciled mid-merge. Hypothesis: WBS allocation is per-checkout with no cross-checkout guard (confirm by running `spur task create --feature X` concurrently from two checkouts of one repo). Cancelled task 1015 held a related one-writer-guard idea.
- **R2.** Withdrawn proposal: Proposed fix direction: cross-checkout allocation guard — either an allocator lock coordinated through the project data dir, or a loud, actionable precheck failure on collision. Smallest mechanism that makes concurrent creation fail loudly or allocate uniquely.
- **R3.** Withdrawn proposal: Proposed acceptance:
  1. Two concurrent `spur task create` runs from two checkouts of the same repo cannot silently allocate the same WBS.
  2. On collision, the error is actionable (names the conflicting checkout/task) rather than silent corruption.
  3. Verified by a repeatable test or documented repro command.

### Acceptance Criteria

Cancellation audit 2026-09-30: N/A for delivery verification. Task remains cancelled; the operator has not reactivated the withdrawn proposal. Unticked proposal checkboxes are rendered as historical bullets to avoid suggesting pending delivery work.

- AC1 — Concurrent creators cannot silently allocate duplicate WBS (withdrawn).
- AC2 — Collision errors identify the conflicting checkout/task (withdrawn).
- AC3 — Repeatable verification of the proposed allocator (withdrawn).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-01T01:08:13.746Z

- Cancelled 2026-09-30 by operator decision: a cross-checkout allocation guard is not worth the complexity. WBS collisions across checkouts are rare and are handled after the fact by fixing or renumbering the duplicate task at merge time. Root cause recorded for reference: the WBS scan and the `.create.lock` are both per-checkout (`packages/app/src/services/task-service.ts` allocateWbs / `createAllocated`).

### Design

Root geometry: WBS allocation reads the max WBS from the local checkout's .spur/spur.db (allocator in packages/app/src/services/task-service.ts). Linked git worktrees share .git but have separate .spur databases, so two concurrent creators (e.g., the i33 session on main and a batch worktree) can scan the same max and allocate the same WBS. Observed 2026-09-30: the runall-A9-485e batch and the i33 session collided in the 102x range; the allocator jumped 1033 past possibly-foreign ids. Confirm the hypothesis with the repro below before implementing.

Chosen mechanism (recommended) - mutual exclusion + re-scan anchored at the git common dir:
- From any linked worktree, git rev-parse --git-common-dir resolves to the main repo's .git - a location all worktrees of the repo share. Place the allocation lock + a small ledger there (e.g., .git/spur/wbs-lock).
- Algorithm: acquire lock via O_EXCL create (bounded retry; stale takeover if lock mtime exceeds a few seconds - crash safety), re-scan max WBS across ALL configured task folders under the lock, allocate, record, release.
- Independent clones = different projects: out of scope by design.
Alternative rejected: DB unique constraint (does not help across separate per-checkout DBs); timestamp-based reservation without a lock (racy).

Failure mode: forced or unresolved collision fails loudly with an actionable error naming the conflicting WBS and the file(s) holding it (AC2); no silent skip-ahead (the 1033 jump is the anti-pattern).

### Plan

1. Reproduce: two spur task create --feature A9 --json run concurrently from main and a linked worktree of a fixture repo; observe duplicate WBS (or document actual allocator behavior if the hypothesis is wrong).
2. Locate the allocation path in packages/app/src/services/task-service.ts (rg -n -i allocat) and wrap it with the common-dir lock + re-scan.
3. Error path: bounded retries, then throw with the conflicting path in the message.
4. Update the docs/04_DESIGN.md satellite (allocator contract) in the same commit (T3).
5. Gates: bun run spur-check, then bun run spur-check-feature once.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Cancellation audit 2026-09-30: N/A for delivery verification. Task remains cancelled; the operator has not reactivated the withdrawn proposal. Unticked proposal checkboxes are rendered as historical bullets to avoid suggesting pending delivery work.

- Unit (packages/app/tests): two concurrent allocations against a shared fixture ledger -> distinct WBS, both persisted; stale lock (backdated mtime) is taken over, not fatal.
- Integration repro script (repeatable artifact): drive two task creates from main + a linked worktree of a fixture; assert distinct WBS and the actionable error path when a duplicate is forced. Commit the script per ADR-130 placement.
- Gates: bun run spur-check; bun run spur-check-feature once.

### Review

Cancellation audit 2026-09-30: N/A for delivery verification. Task remains cancelled; the operator has not reactivated the withdrawn proposal. Unticked proposal checkboxes are rendered as historical bullets to avoid suggesting pending delivery work.

No implementation is certified. Requirements and proposed tests were reviewed against the retained cancellation decision and task History. The withdrawn design remains historical context; no new writer guard, agent fan-out or allocator was implemented.

### References

- packages/app/src/services/task-service.ts (allocation; resolve exact lines via rg -n -i allocat)
- Task lookup resolves across configured task folders (cross-folder max-scan is feasible)
- Evidence: runall-A9-485e batch (worktree) vs i33 session (main checkout), 2026-09-30 ~15:24; docs(tasks) re-scope commits at 15:47 landed on main while the batch ran in its own checkout.
- Related: one-writer-per-tree convention (AGENTS.md); worktree isolation contract.

### History

- 2026-10-01T01:08:14.015Z backlog → cancelled (system)

