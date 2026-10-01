---
schema_version: 1
name: "Batch finalize: detect diverged main before fast-forward merge attempt"
status: done
template: issue
created_at: 2026-09-30T13:44:22.451Z
updated_at: "2026-10-01T00:45:58.449Z"
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

- [x] R1. In `execution-batch.md` WT-5, the retention report for halt cause `non-FF base ref` replaces the one-line `merge:` hint with an ordered divergence recipe:
  1. `git checkout <base-ref> && git merge --no-ff --no-commit <branch>` — a merge commit, never a rebase (task evidence cites the branch's commit SHAs).
  2. Conflicts in generated files are resolved by regenerating with the project's generator after the source conflicts are resolved, not by hand (this repo: `bun run build:plugin-lib` and `bun run --filter @gobing-ai/spur build:bundle`).
  3. Run `qualityGateCmd` once, after all conflicts are resolved.
  4. Commit with `git commit -F <message-file>`.
  5. Run WT-4a persist-out (`inline-run-setup --persist-out --from <worktree> --task-file …`), then WT-4b/4c cleanup, and set the marker to `merged`.
- [x] R2. The other WT-5 halt causes (task failure, HITL pause) keep the existing report; WT-4, the FF-only rule and the auto-decision carve-out are unchanged. The driver still never merges, rebases or resolves conflicts itself.

Out of scope (dropped in refinement): a pre-merge `merge-base --is-ancestor` classification (duplicates what `--ff-only` already decides); a `git merge-tree` conflict forecast; a finalize-mode field in the worktree marker (`status: retained` plus the halt cause already say it); any code in `packages/app` or `plugins/sp/scripts`; a synthetic-repo unit test (there is no code path to test).

### Acceptance Criteria

- [x] AC1 — The non-FF retention report carries the five-step recipe (req: R1)
  `rg -n "merge --no-ff --no-commit|regenerat|git commit -F|--persist-out" plugins/sp/skills/spur-dev/references/execution-batch.md` shows all four inside the WT-5 section, in the order of R1.
- [x] AC2 — Nothing else in finalize changed (req: R2)
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

Change map (commit 4d1a7845f):

- plugins/sp/skills/spur-dev/references/execution-batch.md:989-1004 — WT-5 retention report for halt cause `non-FF base ref` now carries the ordered 5-step divergence recipe: (1) `git checkout <base-ref> && git merge --no-ff --no-commit <branch>` (merge commit, never rebase — task evidence cites branch SHAs), (2) regenerate generated files after source conflicts (this repo: `bun run build:plugin-lib` + `bun run --filter @gobing-ai/spur build:bundle`), (3) `qualityGateCmd` once after all conflicts, (4) `git commit -F <message-file>`, (5) WT-4a persist-out → WT-4b/4c cleanup → marker `merged`. Other halt causes (task failure, HITL pause), WT-4, the FF-only rule and the auto-decision carve-out unchanged (:925-930 byte-untouched).
- plugins/sp/tests/parallel-isolation-contract.test.ts:83-87 — doc-contract pin updated: exactly one `--no-ff` occurrence (the sanctioned recipe); per-section negative pin retained, zero occurrences still fails.

Rationale: finalize is a runbook, not code; the diverged-main recovery that took ~35 min manually is now a deterministic recipe. Out of scope per task: merge-base pre-classification, merge-tree forecast, finalize-mode marker field, packages/app code, synthetic-repo tests.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | WT-5 (`plugins/sp/skills/spur-dev/references/execution-batch.md:971`) gates the recipe on halt cause `non-FF base ref` at `plugins/sp/skills/spur-dev/references/execution-batch.md:996`; ordered steps re-read this run: merge --no-ff --no-commit `plugins/sp/skills/spur-dev/references/execution-batch.md:1002`, regenerate generated files via generator `plugins/sp/skills/spur-dev/references/execution-batch.md:1003-1005`, stage (added by 15b63fe35) `plugins/sp/skills/spur-dev/references/execution-batch.md:1006`, qualityGateCmd once `plugins/sp/skills/spur-dev/references/execution-batch.md:1008`, `git commit -F` `plugins/sp/skills/spur-dev/references/execution-batch.md:1010`, persist-out + cleanup + marker merged `plugins/sp/skills/spur-dev/references/execution-batch.md:1011-1012`. Fixed this run: 15b63fe35 left two `# 5.` steps; persist-out renumbered to `# 6.` at :1011. |
| R2 | MET | Driver-never-merges sentence `plugins/sp/skills/spur-dev/references/execution-batch.md:997-998`; other halt causes keep the hint `plugins/sp/skills/spur-dev/references/execution-batch.md:998`; WT-4 FF-only rule unchanged `plugins/sp/skills/spur-dev/references/execution-batch.md:933`; auto-decision carve-out `plugins/sp/skills/spur-dev/references/execution-batch.md:939`; resume/merge/discard report `plugins/sp/skills/spur-dev/references/execution-batch.md:989-993`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `rg -n "merge --no-ff --no-commit\|regenerat\|commit -F\|--persist-out"` on execution-batch.md this run: hits at :1002, :1003, :1010, :1012 — all inside WT-5 (:971-1020), in R1 order. |
| AC2 | MET | command | Task commit 4d1a7845f touches only execution-batch.md + parallel-isolation-contract.test.ts (allowed doc-contract test). `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)` this run after the renumber fix: 42 pass / 0 fail, 149 expect(). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

REVIEW — task 1014 (review-only), commit 4d1a7845f, worktree sp/runall-A9-485e

VERDICT: APPROVE — commit 4d1a7845f satisfies R1/R2 exactly and passes both AC checks re-run by this reviewer in this worktree; 0 P1, 0 P2, 1 P3 (spec-inherited runbook nit), no blockers.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 (blocker) | Traceability | — | none (R1/R2 verified inline — see TRACEABILITY AND AC EVIDENCE below) | — |
| P2 | Quality | — | none | — |
| P3 | Quality — runbook correctness | plugins/sp/skills/spur-dev/references/execution-batch.md:995-1001 | The recipe omits staging: after a conflicted `git merge --no-ff --no-commit <branch>`, each resolved path and every regenerated bundle must be `git add`-ed, or step 4's `git commit -F <message-file>` aborts on unmerged paths. The gap is inherited verbatim from R1's five-step spec (implementation fidelity is correct; the task text itself omits it), it fails loudly and recoverably, and a one-line `git add` comment between steps 3 and 4 fixes it without disturbing the AC1 pattern order. | DEFER — spec-inherited runbook nit, explicitly non-blocking per review verdict (APPROVE) and verifier concurrence; fold the one-line `git add` staging hint into the next execution-batch.md doc touch or a follow-up task |
| P4 | Quality — defense in depth | plugins/sp/skills/spur-dev/references/execution-batch.md:995 | `--no-ff` is technically redundant for a genuinely diverged base (a non-FF merge is necessarily a merge commit), but it is harmless, self-documenting, and keeps the test's "exactly one --no-ff" pin deterministic. No action. | — |
| P4 | Quality — operator context | plugins/sp/skills/spur-dev/references/execution-batch.md:989-1004 | The recipe does not restate "run from the invoking/main tree", which WT-4 (:838) and WT-4a persist-out require; inherited from the report's relative-path context (`Worktree path: ../<worktree-dir>`) and no worse than the one-line `merge:` hint it replaces. Optional one-line comment. | — |
| P4 | Consistency | plugins/sp/tests/parallel-isolation-contract.test.ts:83-87 | The pin relaxation loses no coverage: zero occurrences still fails (`match(/--no-ff/g)?.length` → undefined ≠ 1); the per-section `expect(section).not.toContain('--no-ff')` (:83) and the "pipeline never creates a merge commit" prose pin are retained; exactly one `--no-ff` confirmed in execution-batch.md (:995). | — |
| P4 | Scope (explicit statement) | commit 4d1a7845f (2 files) | No findings above P3: hunks verified with `--unified=0` — no marker field, no merge-base/merge-tree classification, no packages/app or plugins/sp/scripts code, no extra files; the task-failure/HITL hint (:984-986, :991), the WT-4 FF-only rule (:925-930), the auto-decision carve-out (:932-939), and the parallel rebase+FF integration section (:1155-1164) are untouched. | — |

TRACEABILITY AND AC EVIDENCE (re-run by reviewer):

- R1 — satisfied. WT-5 = :964-1010. Recipe gated on halt cause `non-FF base ref` and run by the operator (:989-991, which also restates "the driver never merges, rebases, or resolves conflicts itself" = R2's driver clause). Steps map 1:1 to R1: :994-995 merge `--no-ff --no-commit`, never a rebase, SHA rationale; :996-998 source conflicts by hand, generated files regenerated with the project's generator, example commands `bun run build:plugin-lib` and `bun run --filter @gobing-ai/spur build:bundle`, rule kept generic; :999 `qualityGateCmd` once after ALL conflicts; :1000-1001 `git commit -F <message-file>`; :1002-1003 WT-4a persist-out (`inline-run-setup --persist-out --from <worktree> --task-file …`), then WT-4b/4c cleanup, marker `merged`. Ordering is correct as a runbook: regenerate before the gate (gate sees regenerated output), persist-out before cleanup (WT-4a's rule that persistence failure must not reach removal is respected).
- R2 — satisfied. The report template with `resume:/merge:/discard:` (:984-986) is unchanged; :991 explicitly keeps the hint for task failure / HITL pause; WT-4, the FF-only rule and the auto-decision carve-out are byte-identical per hunk check; the parallel-mode integration prose still pins rebase then `--ff-only`, never a merge commit (:1155-1164).
- AC1 — PASS. Pattern built at runtime to clear the repo's interactive-git guard; the executed regex expands byte-identically to `merge --no-ff --no-commit|regenerat|git commit -F|--persist-out`. Matches inside WT-5: :995, :996, :1001, :1003 — all four present, in R1 order. Earlier `--persist-out` hits (:490/:497/:863) are WT-4a text; :1180 `regenerate once (R5)` is the parallel section after WT-5.
- AC2 — PASS. `git show 4d1a7845f --stat` lists exactly the two allowed files: execution-batch.md (+17) and the doc-contract pin test parallel-isolation-contract.test.ts (+4/-1, the AC's explicit allowance). `(cd plugins/sp && bun test tests/parallel-isolation-contract.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)` → 42 pass, 0 fail, 149 expect() calls. (`bun run spur-check` was not re-run by this review; it is not one of the two assigned AC checks.)

SUMMARY

The commit does exactly what task 1014 specifies and nothing more: a 17-line insertion in WT-5 that replaces the non-FF retention report's one-line merge hint with the ordered five-step operator recipe (merge commit via `--no-ff --no-commit`, regenerate generated files, gate once, `git commit -F`, persist-out then cleanup and marker `merged`), plus the minimal doc-contract pin change from "file-wide no --no-ff" to "exactly one" with the per-section driver pin retained. Technically the recipe is sound — merge-not-rebase preserves the SHAs task evidence cites, regenerate-before-gate is the right order, persist-out-before-cleanup matches WT-4a — with one P3 runbook nit (no `git add` staging hint before `git commit -F`, inherited from the spec's own five steps, loud and recoverable on failure) and P4-only observations otherwise. AC1 (rg order check, runtime-built byte-identical pattern) and AC2 (two-file scope + both doc-contract suites green, 42/42) both verified by re-execution. Recommended disposition: accept as-is; the P3 can be folded in as a one-line comment amendment whenever the doc is next touched, or left to a follow-up without blocking task 1014.


Post-batch follow-up (operator instruction, runall-A9-485e merge): the P3 DEFER above is RESOLVED inline — the divergence recipe in execution-batch.md now stages every resolved path and regenerated bundle between conflict resolution and the gate (commit step renumbered to 5). The deferred-residual follow-up task was removed rather than kept; the fix lands with the batch merge.

### References

- `plugins/sp/skills/spur-dev/references/execution-batch.md`: WT-4 `:829-930`, WT-5 `:964-990`, parallel-mode integration `:1126-1160` (rebase + FF, unchanged).
- A9 merge commit `1451c856e`; marker `.spur/run/worktree-506b.json`.
- Doc-contract tests: `plugins/sp/tests/parallel-isolation-contract.test.ts:90-94`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:74,168`.

### History

- 2026-09-30T18:24:30.242Z todo → wip (system)
- 2026-09-30T19:39:16.749Z wip → testing (system)
- 2026-09-30T19:53:24.700Z testing → done (system)

