---
name: execution-batch-continuation
description: "--continue resume of an interrupted batch (task 1128 split): original frozen identity re-binding (BC-1), checkpoints-as-hints reconciliation (BC-2) and ordering/write-ownership/terminal-mix rules (BC-3). Read it with --continue."
see_also:
  - execution-batch
  - execution-workflow
---

## Batch continuation (`--continue`) — identity binding + checkpoint reconciliation (task 0919)

`--continue` resumes an interrupted batch against the batch's **original identity** — never
whatever a fresh selector resolution or a newer unrelated checkpoint would suggest.

### BC-1 — Re-bind the original frozen identity (R1; AC1/AC5)

Resume identity comes from persisted batch artifacts, in priority order:

1. **WT-3 marker** (worktree batches): the marker's `command` + `selector` and worktree
   name/branch re-derive the original launch (the WT-6 fallback already resolves this way).
2. **Persisted batch report** (`.spur/run/worktree-<marker-id>-batch-report.md`, or the
   invoking-tree Step 5 report of a non-worktree batch): its `Plan:` row IS the frozen ordered
   membership — the resumed loop iterates exactly those WBS rows.

Re-running the selector is a **validation, not a re-definition**: tasks that newly match the
selector but are absent from the frozen plan are reported `not-admitted` and never executed —
freshly listed tasks do not join a resumed batch implicitly. A frozen task whose dependencies
changed after freeze may invalidate its admission: report `blocked (admission invalidated —
re-plan required)` and stop for operator decision. The authorized frozen set is never silently
rewritten (Design).

### BC-2 — Checkpoints are hints (R2; AC2)

Do **not** pick the resume point by mtime alone: `ls -t … | head -1` over `.spur/memory/sessions/`
is identity-blind, so an unrelated later session (different feature or task) must not become
authoritative. Select candidate checkpoints by identity first, newest first within the match:

- frontmatter `workflow` is `task-pipeline` (or the batch's own workflow), and
- `feature_id` equals the batch's feature selector, or `task_wbs` is a member of the frozen plan.

Checkpoints matching neither rule are ignored regardless of recency. A matched checkpoint only
**hints** where the loop left off (`phase`, `next_action` — surface them to the operator); the
driver then reconciles against authoritative state before skipping or repeating any task:

- **Skip** requires ALL of: task file status `done` AND a persisted PASS verdict artifact
  (`.spur/run/<wbs>-verdict.json`, or the worktree-persisted
  `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json`) consistent with the task's
current metadata. Anything less is not a valid skip.
- **Stale or mismatched evidence** — checkpoint claims done but the verdict artifact is missing,
  the task file moved backwards, or the recorded `source_commit`/`digest` no longer matches —
  yields outcome `recheck`: re-run that task's pipeline. When reconciliation cannot proceed
  safely (lost worktree, unresolvable marker), report `blocked` with the reason. Never treat an
  unverified claim as done.

### BC-3 — Ordering, write ownership, terminal mix, evidence (R3/R4; AC3/AC4)

Sequential dependency-correct execution remains the default; opt-in `--mode parallel` keeps the
existing proven-independence requirements with one writer per tree (Step 3). Mixed terminal
results resume under the unchanged failure policy (Step 4). The Step 5 report keeps per-task
outcomes distinct — `done | failed | blocked | skipped | not-attempted` plus the resume-only
`recheck` and `not-admitted` — and the batch verdict stays `halted`/`aborted`: a resumed,
partially-complete batch is never reported `clean`. Worktree evidence survives cleanup via the
invoking-tree persistence in Step 5 (task 0720 R3); a persistence failure routes to **WT-5**
(retain tree + branch), so partial outcomes are never silently lost and never read as a completed
batch.

See [cross-cutting.md](cross-cutting.md) § "Session Checkpoint Convention" for the canonical
frontmatter fields and the per-task owner-mismatch semantics
(`packages/app/src/workflow/checkpoint-contract.ts`).
