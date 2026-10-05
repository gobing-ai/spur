---
schema_version: 1
name: Make task-WBS allocation collision-safe across concurrent worktrees
status: backlog
template: standard
created_at: 2026-10-05T02:56:07.281Z
updated_at: "2026-10-05T02:56:15.259Z"

feature_id: F21
---

## 1089. Make task-WBS allocation collision-safe across concurrent worktrees

### Background

During the E72 batch, two sessions allocated WBS 1086 independently: a worktree run's `residual-scan settle` filed `1086_residuals-from-1085.md` while the invoking tree created `1086_include-desktop-packaging-in-the-root-build.md`. Both corpora had max 1085 at allocation time, so both allocators returned 1086; merging the worktree would have put two files with id 1086 in one corpus. Repaired by hand (the residual task was re-created as 1087, commit `828afe56b`) — a merge-time duplicate-id corpus.

AC-subset note: the scenario below is new for F21's AC; add it there when this task is refined.

### Requirements

- [ ] R1. \`spur task create\` will not allocate an id that already exists in a sibling worktree or registered checkout of the same repository; it either picks the next free id considering those corpora or fails loudly naming the colliding path.
- [ ] R2. Single-tree behaviour is unchanged (no lock contention regression, same race safety within one corpus).
- [ ] R3. A regression test covers two checkouts of one repo allocating concurrently.

### Acceptance Criteria

- [ ] AC1 — Two checkouts of one repository cannot allocate the same WBS

Task-local verification: a test that creates a worktree, allocates in both trees, and asserts distinct ids (or an explicit collision refusal naming the other tree).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: at allocation, enumerate sibling trees via `git worktree list --porcelain` plus the registered projects (`~/.config/spur/projects.json`) and treat their task folders as taken ids; reserve under the existing allocation lock, moved to the git common dir so it spans worktrees.
- Rejected: a global id registry (misses unregistered/foreign checkouts), and detect-only warnings (the collision lands in the corpus at merge time, after the fact).
- Invariants: allocation stays deterministic and offline; a repo with no worktrees behaves exactly as today.

### Plan

- [ ] 1. Reproduce: two worktrees of one repo, allocate in both, observe the duplicate.
- [ ] 2. Implement the sibling-tree scan + common-dir reservation.
- [ ] 3. Add the regression test.
- [ ] 4. Gates: `(cd apps/cli && bun test tests/commands/task.test.ts)`, `bun run typecheck`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
