---
schema_version: 1
name: Assert the wrapup learnings artifact shape before appending it to memory
status: done
template: feature-impl
created_at: 2026-09-27T07:21:49.963Z
updated_at: "2026-09-28T21:26:46.584Z"
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

- [x] R1. Before append, the learnings artifact must contain a date, a task WBS, and at least one markdown bullet; no exact heading format is required.
- [x] R2. A nonempty narration-only artifact routes to the existing repair state with a distinct `invalid-learnings-shape` status, without appending it.
- [x] R3. A valid artifact appends exactly once as captured; the existing empty/missing soft-skip behavior remains.
- [x] R4. Tests cover narration-only rejection, valid append, and the unchanged executor-failure route.

### Acceptance Criteria

- [x] AC1 — Narration-only capture reaches repair and leaves memory unchanged (req: R1, R2)
- [x] AC2 — A dated WBS bullet appends once without rewriting its bytes (req: R1, R3)
- [x] AC3 — Empty/missing capture and executor failure retain their existing routes (req: R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

`expectFile` checks existence; the engine's `contract-violation` trigger is not a content predicate. After a successful doc-sync action, route through a small `learnings-validate` state. Its shell action writes PASS or `invalid-learnings-shape` to a run-scoped status after checking for a date, a four-digit WBS, and one markdown bullet. Route PASS to `learnings-append` and invalid shape to the existing `repair` state. The append action remains byte-for-byte and retains its soft skip for empty/missing captures. Amend repair's status text to distinguish shape failure from the existing missing-file contract violation.

Keep this a structural check only; the doc-sync prompt owns the prose quality. No new engine-level content contract is needed.

### Plan

- [x] Add a post-doc-sync validation state and status file; keep the existing contract-violation and executor-failure routes.
- [x] Route valid capture to append and invalid nonempty capture to repair, with a distinct log reason.
- [x] Test narration-only, valid dated WBS bullet, empty/missing, and executor-failure paths.
- [x] Run workflow validation, focused wrapup tests, and `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:112` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:140` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:148` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:23` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:59` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:610` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:616` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:663` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/wrapup-pipeline.yaml` — the `learnings-validate` shell asserts a date (`[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]`), a four-digit WBS, and a markdown bullet (`/^[[:space:]]*[-*] /`) before writing PASS; pinned by `packages/app/tests/workflow/wrapup-pipeline.test.ts` "learnings-validate is a shell-only structural gate that names its status file" |
| R2 | MET | `wrapup-pipeline.yaml` — the invalid-shape edge routes `learnings-validate → repair` on the `invalid-learnings-shape` status; test "R1/R2: a narration-only capture fails the gate, routes to repair, and never appends" asserts the status, the route, and that `.spur/memory/learnings.md` is never created |
| R3 | MET | `wrapup-pipeline.yaml` — a valid capture routes to the unchanged byte-for-byte `learnings-append` (`cat "$LEARNINGS_FILE" >> .spur/memory/learnings.md`); test "R3: a dated WBS bullet passes and appends once, byte-for-byte" asserts memory equals the capture plus one newline; the empty/missing test asserts the soft skip |
| R4 | MET | `packages/app/tests/workflow/wrapup-pipeline.test.ts` — covers narration-only rejection, valid append, empty/missing soft skip, the unclassifiable-status defense, and the unchanged doc-sync executor-failure route ("R4: the doc-sync executor-failure route is unchanged") |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `(cd packages/app && bun test tests/workflow/wrapup-pipeline.test.ts)` → 35 pass / 0 fail; the narration case asserts `invalid-learnings-shape` and leaves `.spur/memory/learnings.md` absent |
| AC2 | MET | test | same run; the valid-capture case asserts `readFileSync('.spur/memory/learnings.md') === capture + '\n'` — appended once, bytes unrewritten |
| AC3 | MET | test | same run; the empty/missing case asserts PASS + soft skip, and the doc-sync edge pin asserts `[repair contract-violation, learnings-validate action-ok, failed always]` (executor failure unchanged) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:f9388f7d1682e22c58301a5ca66f0337fd7969cfcc6cf3d8e37fe27840657ec9 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:17.742Z backlog → todo (system)
- 2026-09-28T21:26:36.597Z todo → wip (system)
- 2026-09-28T21:26:36.980Z wip → testing (system)
- 2026-09-28T21:26:46.584Z testing → done (system)

