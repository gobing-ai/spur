---
schema_version: 1
name: Fix the record-stage Solution backfill's diff base and pathspec
status: todo
template: feature-impl
created_at: 2026-10-05T22:51:56.246Z
updated_at: "2026-10-06T00:07:45.068Z"
feature_id: H1

ac_altitude: task-local
---

## 1090. Fix the record-stage Solution backfill's diff base and pathspec

### Background

Run 9e8af77d-3366-42d8-94f9-8abaf6ec002e (task 1089, E71) halted the `record` hop with
`GuardDeniedError: Lifecycle transition blocked: spur task check 1089 --as testing failed —
L3.solution-file-line [Solution]: Solution must contain at least one file:line citation`, and the
backfill it ran in the same invocation had written:

    Change-map (auto-generated — implement step did not record a Solution).
    | `(no changes detected)` |

Root cause, read from the source: `packages/app/src/services/task-record.ts:804-811` builds the
`--solution-from-diff` input with

    git diff -U0 HEAD -- '*.ts' '*.tsx' '*.js'

which makes the safety-net backfill a no-op in two independent cases:

- **Committed work is invisible.** The diff base is the working tree vs `HEAD`, so anything the run
  already committed contributes nothing. That is the *documented* `--worktree` flow: WT-3b commits
  the batch's writes before WT-4, and the implement stage's own commits land the same way. The run
  above had five commits (`b6107a373`, `ad895ed51`, `68bf13242`, `54abbe0d9`, `bbfaae312`) and the
  backfill still reported "no changes detected".
- **Non-JS changes are invisible.** The pathspec admits only `*.ts`/`*.tsx`/`*.js`, so a
  documentation, corpus, YAML, SQL or Markdown-only task yields an empty backfill by construction —
  the gate then denies with an `L3` finding about the *Solution*, not about the backfill.

The consequence is doubly misleading. The author is told their Solution is malformed when the real
condition is an empty backfill; and because the pipeline's own `implement` hop is contractually the
Solution writer, a run that relies on the fallback discovers the gap only at the `record → testing`
guard, after the quality gate, review and verification have all been spent. The `L4.anchor-subject-mismatch`
and `L4.anchor-unresolved` rules additionally mean a hand-authored row must cite a real `file:line`,
so the denial cannot be satisfied by prose.

Observed in the same session: authoritative recovery was to author `## Solution` by hand through
`spur task update --section Solution --from-file`, after which `spur task record` succeeded with
`solutionBackfilled: false` (the authored body is preserved — the backfill is fallback-only, so
fixing it cannot overwrite an authored change-map).

Out of scope: the `implement` stage's primary responsibility to write Solution, and the
`requireDiff` guard, which reads a pre-action snapshot rather than this diff.

### Requirements

- [ ] R1. The `--solution-from-diff` backfill names the files a run changed even when those changes
      are already committed: its diff base is the invocation's run base, not the working tree
      (`packages/app/src/services/task-record.ts:804-811`).
- [ ] R2. The backfill covers every changed tracked file it is expected to describe, not only
      `*.ts`/`*.tsx`/`*.js` — a documentation, YAML or corpus-only task must produce rows too.
- [ ] R3. When the backfill still finds nothing (a genuinely empty diff, or no resolvable base), the
      denial distinguishes "the backfill produced no rows" from "no Solution was authored", so the
      `L3.solution-file-line` message stops misattributing the cause.
- [ ] R4. The existing fallback-only contract is preserved: an authored `## Solution` is never
      overwritten, and `spur task record` without `--solution-from-diff` is unchanged.

### Acceptance Criteria

- [ ] AC1 — A committed run's changes are named by the backfill (R1)
- [ ] AC2 — A non-JS-only change set is named by the backfill (R2)
- [ ] AC3 — An empty backfill reports its own cause, not a malformed Solution (R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Diff base (R1).** The run base already exists: the pipeline precheck writes
`.spur/run/<wbs>-base.sha` (`config/workflows/task-pipeline.yaml`, precheck `onEnter`, task 0950's
base-commit capture) precisely so residual scans stay anchored to one commit across a resumed run.
Resolve the base in this order and stop at the first that yields a commit: an explicit option on the
record call, `.spur/run/<wbs>-base.sha`, then `HEAD`. Diff `<base>` against the working tree so
uncommitted and committed work are both covered, and keep the command on the `ProcessExecutor` seam
(`packages/app/src/services/task-record.ts:805`, `no-direct-process-spawn`).

**Pathspec (R2).** Dropping the extension list entirely and filtering afterwards is the smaller
change to reason about than curating a longer allowlist: exclude the generated and ignored planes the
row set must not advertise (`.spur/**`, `docs/tasks*/**` status churn, lockfile noise) and keep the
existing per-file first-line anchors. Cap the row count as the current renderer does, and keep the
`file:line` shape the `L4` anchor rules expect — one citation per row, an existing file, an in-range
line.

**Message (R3).** The reconciliation path already knows whether it produced rows; thread that through
so the `L3.solution-file-line` denial names the empty backfill explicitly, and leave the "author a
Solution" wording for the case where no backfill was requested.

**Constraints.** No new public CLI surface: this is the existing `--solution-from-diff` flag and the
existing `spur task record` verb. `mutationPolicy` and the record-stage transition guards are
untouched, and no service seam moves.

**Verification direction.** Extend `packages/app/tests/services/task-record.test.ts`, which already
pins the `(no changes detected)` renderer (`:698`) — the new cases assert the *presence* of the
changed paths, so they fail against today's `git diff HEAD -- '*.ts'` base and pathspec.

### Plan

1. Failure list first, in `packages/app/tests/services/task-record.test.ts` (or its sibling fixtures),
   against a scratch git repository:
   (a) a change committed on the branch with a clean working tree is named by the backfill;
   (b) a Markdown/YAML-only change set is named;
   (c) a genuinely empty diff reports the backfill-specific cause, not `L3.solution-file-line`'s
   authoring message;
   (d) the no-base fallback preserves today's `HEAD` behavior, and an authored Solution is still
   preserved (`solutionBackfilled: false`).
2. R1 + R2 in `packages/app/src/services/task-record.ts`: resolve the base (explicit option →
   `.spur/run/<wbs>-base.sha` → `HEAD`), diff against the working tree, replace the extension
   allowlist with an exclude-and-filter pass.
3. R3: thread the empty-backfill signal into the denial text the CLI renders; keep the wording for a
   requested-but-empty backfill distinct from the no-backfill path.
4. Gates: targeted `packages/app` suite while iterating, then `bun run spur-check` once.
5. Receipt: the four cases above with their pasted output, plus one end-to-end `spur task record
   <wbs> --solution-from-diff --transition testing` run inside a worktree batch whose implement stage
   committed, showing rows instead of `(no changes detected)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T00:07:45.068Z backlog → todo (system)

