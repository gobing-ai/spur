---
schema_version: 1
name: "Batch finalize: detect diverged main before fast-forward merge attempt"
status: todo
template: issue
created_at: 2026-09-30T13:44:22.451Z
updated_at: "2026-09-30T14:33:11.535Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1014. Batch finalize: detect diverged main before fast-forward merge attempt

### Background

Filed from the A9 post-batch review (open issue O3). Re-verified 2026-09-30: **issue valid, original solution replaced**.

During A9 main moved mid-batch (operator commits `6a73f692e`, `4add06b6d`, `7b9f03bb6`, `193cf85f8`, `48bf1a8cc`, `8027248e2`), so the `--worktree` finalize could not fast-forward. The manual merge took ~35 min: 4 conflicts (export union in `packages/app/src/index.ts`, `feature-check.ts`, 2 generated lib bundles), 3 full gate runs, merge commit `1451c856e`.

What already exists (so is not rebuilt):

- Finalize is a **runbook, not code**: `plugins/sp/skills/spur-dev/references/execution-batch.md` WT-4 / WT-5. No `.ts` file runs `git merge --ff-only`; the original plan's "edit the packages/app lib" has no target.
- `git merge --ff-only` is already the divergence classifier and fails closed (WT-4, `execution-batch.md:846`); "Fast-forward only … fall through to the retention path (WT-5) and report the divergence" (`:925-930`).
- WT-5 (`:964-990`) retains the worktree + branch, sets the marker to `retained`, and prints a report whose halt cause can be `non-FF base ref`.

The actual gap is the WT-5 report's single hint — `merge: git checkout <base-ref> && git merge <branch>  # resolve conflicts manually` — which left the operator to rediscover four things: generated files are regenerated not hand-merged, the gate runs once after all conflicts, a merge commit (not a rebase) keeps the commit SHAs that task evidence cites, and WT-4a persist-out plus WT-4b/4c cleanup still have to run after a manual merge or the worktree's `.spur/run` evidence is lost.

### Requirements

- [ ] R1. In `execution-batch.md` WT-5, the retention report for halt cause `non-FF base ref` replaces the one-line `merge:` hint with an ordered divergence recipe:
  1. `git checkout <base-ref> && git merge --no-ff --no-commit <branch>` — a merge commit, never a rebase (task evidence cites the branch's commit SHAs).
  2. Conflicts in generated files are resolved by regenerating with the project's generator after the source conflicts are resolved, not by hand (this repo: `bun run build:plugin-lib` and `bun run --filter @gobing-ai/spur build:bundle`).
  3. Run `qualityGateCmd` once, after all conflicts are resolved.
  4. Commit with `git commit -F <message-file>`.
  5. Run WT-4a persist-out (`inline-run-setup --persist-out --from <worktree> --task-file …`), then WT-4b/4c cleanup, and set the marker to `merged`.
- [ ] R2. The other WT-5 halt causes (task failure, HITL pause) keep the existing report; WT-4, the FF-only rule and the auto-decision carve-out are unchanged. The driver still never merges, rebases or resolves conflicts itself.

Out of scope (dropped in refinement): a pre-merge `merge-base --is-ancestor` classification (duplicates what `--ff-only` already decides); a `git merge-tree` conflict forecast; a finalize-mode field in the worktree marker (`status: retained` plus the halt cause already say it); any code in `packages/app` or `plugins/sp/scripts`; a synthetic-repo unit test (there is no code path to test).

### Acceptance Criteria

- [ ] AC1 — The non-FF retention report carries the five-step recipe (req: R1)
  `rg -n "merge --no-ff --no-commit|regenerat|git commit -F|--persist-out" plugins/sp/skills/spur-dev/references/execution-batch.md` shows all four inside the WT-5 section, in the order of R1.
- [ ] AC2 — Nothing else in finalize changed (req: R2)
  `git diff --stat` lists only `plugins/sp/skills/spur-dev/references/execution-batch.md` (plus a doc-contract test file if one pins the WT-5 text), and `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)` exits 0.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-30T14:33:10.486Z

#### Q&A entry — 2026-09-30 (refinement)

- **Is the issue still valid?** Partly (closed). "Stalled with no guidance" overstates it: WT-5 already retains and reports. The guidance it prints is one line and misses the four steps that cost the time, which is what this task fixes.
- **Should the driver merge a diverged base itself when the merge is clean?** No (closed). `execution-batch.md:925-930` makes FF-only a deliberate rule: generated corpus files are conflict-prone and an unattended merge is either trivially correct or does not happen. Operator decision to revisit, not this task.
- **Why `--no-ff --no-commit`?** The repo's tool guard blocks a bare `git merge` that opens an editor; `--no-commit` leaves the commit to step 4 (`git commit -F`).
- **Overlap with 1018 / 1019?** None (closed). The original plan named `plugins/sp/tests/task-pipeline-resilience.test.ts` as a test home, which 1019 edits; this refinement no longer touches it.

### Design

Documentation-only change to the WT-5 retention report in `execution-batch.md`; see Requirements. No code path, marker field or new step.

### Plan

1. Edit the WT-5 report block in `plugins/sp/skills/spur-dev/references/execution-batch.md`: keep `resume:` and `discard:`; when the halt cause is `non-FF base ref`, print the R1 recipe in place of the `merge:` line. Keep the project-specific generator commands as an example, the rule itself generic (the plugin ships to other repos).
2. Run the two doc-contract tests named in AC2; adjust an assertion only if it pins the replaced line.
3. `bun run spur-check`.

### Root Cause

The retention report treated every halt cause alike. For a diverged base the one-line merge hint omitted the steps that are specific to this harness (regenerate generated files, gate once, keep SHAs, persist evidence out before cleanup), so each was rediscovered by trial.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- AC1 `rg` output and AC2 `git diff --stat` recorded here.
- `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)`.
- `bun run spur-check`.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/skills/spur-dev/references/execution-batch.md`: WT-4 `:829-930`, WT-5 `:964-990`, parallel-mode integration `:1126-1160` (rebase + FF, unchanged).
- A9 merge commit `1451c856e`; marker `.spur/run/worktree-506b.json`.
- Doc-contract tests: `plugins/sp/tests/parallel-isolation-contract.test.ts:90-94`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:74,168`.

### History
