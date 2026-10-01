---
schema_version: 1
name: Commit diffstat-arm conformance test (durable AC1/AC2 evidence for 1033)
status: todo
template: issue
created_at: 2026-10-01T16:20:50.852Z
updated_at: "2026-10-01T16:46:49.319Z"

feature_id: D9
---

## 1039. Commit diffstat-arm conformance test (durable AC1/AC2 evidence for 1033)

### Background

**Durable-evidence follow-up to task 1033's R1 (diff-sized verify floor), filed when the original executable evidence was destroyed.** 1033's AC1/AC2 were verified with a jq conformance check over four fixtures (`/tmp/1033-e2e/{small,sensitive,large}.json`), output appended to `.spur/run/1033-e2e-evidence.log` inside the batch worktree. At batch closeout the worktree was removed and gitignored run directories with it — the executable evidence now survives only as prose quoted in `docs/tasks5/1033_pipeline-execution-efficiency-proportional-gate-diff-sized-f.md`. This is the same durability gap F93 ("Durable verification evidence: the completion gate reads the tracked task record, not a gitignored artifact") closed for verify receipts — precedent for the approach, not the owner surface.

**The contract being pinned (1033 R1, condition 5 of the verify-only dispatch arm):** the verify stage's diffstat arm decides host-inline vs. subagent dispatch from

```
files <= 3 && insertions + deletions <= 60 && sensitive == false   →  host-inline
otherwise                                                           →  unchanged floor
```

"Unchanged floor" means verify keeps whatever isolation it already has (subagent dispatch) — **more isolation, never less**. The host log line on the inline path is exact and must not drift:

```
stage verify executed inline in session <sid> (below dispatch floor: diffstat files <f> lines <n>)
```

**Surface:** test-only addition to `plugins/sp/tests/task-diffstat.test.ts` (the producer suite from 0943; producer `plugins/sp/scripts/task-diffstat.ts`). The consumer of this decision is host prose in the inline pipeline driver (see `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` around line 317) — there is no shared function to call, so the test mirrors the documented decision table and cites that anchor in a comment.

**Fixture classes to cover (from the 1033 evidence run):** small (e.g. `{files:2, insertions:30, deletions:10, sensitive:false}` → inline), sensitive (small but `sensitive:true` → floor), large (under 3 files but `insertions + deletions > 60` → floor), and missing/null diffstat fields (→ floor, defensive default). Assert the exact log template on the inline path.

**In scope:** the conformance describe block per the table above; one mutation check (temporarily break a threshold, confirm the test fails, revert) to prove it bites; quoting the test run in the task.

**Out of scope (anti-drift):** no production code changes — not `task-diffstat.ts`, not `wrapup-steps.ts`, not the driver reference, not workflow YAML; no extracting a shared decision helper (the consumer is prose; a mirror test with a source comment is the point); no new fixtures framework; don't restate the thresholds anywhere except the test and its cited anchor.

**Adjacent coverage (2026-10-01, commit fd2ab09f5)**

A doc-text parity pin landed in `plugins/sp/tests/command-flag-parity.test.ts`: it asserts the driver prose contains the arm thresholds and log-template text (fails-when wording, `<= 60`, `.sensitive == false`, `below dispatch floor:`). That pins the contract description, not implementation behavior. This task's ACs (behavioral decision-table fixtures in `plugins/sp/tests/task-diffstat.test.ts`) remain the outstanding work; implement them without duplicating the prose-parity assertions.

### Requirements

- R1: In `plugins/sp/tests/task-diffstat.test.ts` (1033 R1 surface, producer `plugins/sp/scripts/task-diffstat.ts`), add a conformance test that mirrors the condition-5 diffstat-arm decision table from `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:317`: `files <= 3 && insertions + deletions <= 60 && sensitive == false` → host-inline; otherwise → unchanged floor (more isolation, never less).
- R2: Cover the four observed fixture classes: small (→ inline), sensitive (→ floor), large (→ floor), and missing/null diffstat fields (→ floor, defensive).
- R3: Also pin the exact host log template (`stage verify executed inline in session <sid> (below dispatch floor: diffstat files <f> lines <n>)`) so a wording change cannot slip silently.

### Acceptance Criteria

- AC1: `cd plugins/sp && bun test tests/task-diffstat.test.ts` passes with the new cases and fails if any threshold or log wording is mutated — quote the run in the task.
- AC2: No production code changes; test-only diff.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] Add conformance describe block per R1-R3.
- [ ] Mutation-check one threshold to confirm the test bites (then revert).
- [ ] `bun run spur-check` on the change; commit.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
