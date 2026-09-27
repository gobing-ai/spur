---
schema_version: 1
name: Assert the wrapup learnings artifact shape before appending it to memory
status: todo
template: feature-impl
created_at: 2026-09-27T07:21:49.963Z
updated_at: "2026-09-27T16:45:17.742Z"
feature_id: D62

ac_altitude: task-local
priority: P2
estimate_hours: 2
---

## 0986. Assert the wrapup learnings artifact shape before appending it to memory

### Background

Found in the `/sp-dev-wrap 0966 --auto --agent inline --merge` run (`adec4790`).

**Symptom.** `.spur/run/adec4790-…-wrapup-learnings.md` — the wrapup learnings artifact — contained
two lines of the doc-sync agent's *narration* instead of its answer:

```text
Single task WBS `0966`. Let me read the task, the constitution, and the current state of the docs that need drift repair.
The task was run on a worktree branch. Let me find the task file and read the current docs to assess drift.
```

`learnings-append` (a `shell` step) appended that artifact verbatim to the tracked
`.spur/memory/learnings.md`, so the narration was staged into the corpus before the invoking surface
reviewed and hand-repaired it.

**Root cause.** The `doc-sync` `agent.run` declares
`answerFile: .spur/run/${vars.__runId}-wrapup-learnings.md` and the same path as `expectFile`
(`config/workflows/wrapup-pipeline.yaml`, doc-sync block). `expectFile` asserts the file EXISTS and
nothing about its shape, so a stream-of-thought capture satisfies the post-condition. The pipeline's
own comment one step earlier already names this class — "a clean exit that missed its declared
answerFile/expectFile post-condition" — and 0871 built the violation→repair edge for it, but the
learnings capture is not covered by that predicate.

**Evidence.** `.spur/run/adec4790-5b61-456c-95e8-f01addeef35d-wrapup-learnings.md` (2 narration lines);
`adec4790` run record `learnings-append/shell` → `.spur/memory/learnings.md`; the committed
`chore(wrap): record 0966 wrap-up metrics and learnings` (0f92bdd0c) whose message records the repair.

AC altitude: task-local. These regression scenarios validate the wrapup pipeline's append contract; they are not new D62 feature ship criteria.

**Refine corrections (2026-09-27)**

- `expectFile` checks existence only; content validity needs a validation state before append. Invalid shape routes to repair with a distinct status.

### Requirements

- [ ] R1. Before append, the learnings artifact must contain a date, a task WBS, and at least one markdown bullet; no exact heading format is required.
- [ ] R2. A nonempty narration-only artifact routes to the existing repair state with a distinct `invalid-learnings-shape` status, without appending it.
- [ ] R3. A valid artifact appends exactly once as captured; the existing empty/missing soft-skip behavior remains.
- [ ] R4. Tests cover narration-only rejection, valid append, and the unchanged executor-failure route.

### Acceptance Criteria

- [ ] AC1 — Narration-only capture reaches repair and leaves memory unchanged (req: R1, R2)
- [ ] AC2 — A dated WBS bullet appends once without rewriting its bytes (req: R1, R3)
- [ ] AC3 — Empty/missing capture and executor failure retain their existing routes (req: R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

`expectFile` checks existence; the engine's `contract-violation` trigger is not a content predicate. After a successful doc-sync action, route through a small `learnings-validate` state. Its shell action writes PASS or `invalid-learnings-shape` to a run-scoped status after checking for a date, a four-digit WBS, and one markdown bullet. Route PASS to `learnings-append` and invalid shape to the existing `repair` state. The append action remains byte-for-byte and retains its soft skip for empty/missing captures. Amend repair's status text to distinguish shape failure from the existing missing-file contract violation.

Keep this a structural check only; the doc-sync prompt owns the prose quality. No new engine-level content contract is needed.

### Plan

- [ ] Add a post-doc-sync validation state and status file; keep the existing contract-violation and executor-failure routes.
- [ ] Route valid capture to append and invalid nonempty capture to repair, with a distinct log reason.
- [ ] Test narration-only, valid dated WBS bullet, empty/missing, and executor-failure paths.
- [ ] Run workflow validation, focused wrapup tests, and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:17.742Z backlog → todo (system)

