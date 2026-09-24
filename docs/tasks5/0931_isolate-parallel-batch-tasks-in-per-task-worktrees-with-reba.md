---
schema_version: 1
name: Isolate parallel batch tasks in per-task worktrees with rebase-and-fast-forward integration
status: done
template: feature-impl
created_at: 2026-09-23T06:52:00.127Z
updated_at: "2026-09-24T18:27:38.523Z"
feature_id: H1

priority: P2
estimate_hours: 6
dependencies: ["0930"]
---

## 0931. Isolate parallel batch tasks in per-task worktrees with rebase-and-fast-forward integration

### Background

Covers H1 Slice A, R21–R25, and replaces 0142 R6.x. Today `/sp:dev-runall --mode parallel` runs concurrent task pipelines in **one shared working tree**:
- `plugins/sp/skills/spur-dev/references/execution-batch.md:228-232` ("its own subagent/worktree-safe context", which no step creates);
- `execution-batch.md:935-949` ("Dispatch via `spur agent run` per task").

Two concurrent implement/test/record stages then edit the same files, index and `docs/tasks*/`. That breaks the AGENTS.md rule "One writer per working tree".

`--worktree` exists, but it is sequential only: one tree for the whole batch, and `--worktree --mode parallel` is rejected (`execution-batch.md:446-447`, `:872-873`; `plugins/sp/commands/dev-runall.md:59-61`; `plugins/sp/skills/spur-dev/references/flag-glossary.md:434-435`).

The single-task worktree lifecycle is already specified and battle-tested, and is reused here:
- WT-1: dirty-tree precheck.
- WT-2: create, `sp/run-<wbs>-<short-id>`.
- WT-3: marker.
- WT-3b: commit.
- WT-4: FF + holder cleanup + remove.
- WT-5: retain.

What is missing is the per-task fan-out around it, a concurrency bound, rebase-before-FF integration, and one regeneration of generated regions after integration.

This is prose-contract work. The batch orchestrator (`sp:super-planner`) executes `execution-batch.md`; there is no engine code for the batch loop ("Zero engine code", `execution-batch.md:25`). Enforcement is by plugin contract tests.

Rubric: E2 D2 L1 C1 R1 = 7. Kept as one task because R21–R25 are one lifecycle; splitting it would leave a parallel mode that isolates but cannot integrate.

### Requirements

- [x] R1. Parallel isolation: under `--mode parallel`, the orchestrator runs every concurrently executing task in its own create-mode worktree (`sp/run-<wbs>-<short-id>`, cut from the current base-ref tip), with its own WT-3 marker (`command: dev-runall`, `selector: <wbs>`, plus a `batchId` shared by all markers of the batch). Two task pipelines never share a working tree, and the main tree gets no task writes while the batch runs.
- [x] R2. Bounded concurrency: at most `--concurrency <n>` task pipelines run at once (default 2, `n ≥ 1`). A task becomes eligible only when all of its in-set dependencies are **integrated** onto the base ref, not just finished. Omitting `--mode` stays sequential.
- [x] R3. Integration: a succeeded task commits on its branch (WT-3b), then the orchestrator in the main tree runs `git -C <wt> rebase <BASE_REF>` and `git merge --ff-only <branch>`, followed by WT-4b holder cleanup, `git worktree remove` and `git branch -d`. It never creates a merge commit. Integrations are serialized (one at a time) in completion order.
- [x] R4. Conflict: if the rebase fails, run `git -C <wt> rebase --abort`, retain the worktree and branch (WT-5, marker `retained`), and record outcome `integration-conflict`. The batch report names the path, the branch, and resume / merge / discard commands. The task's dependent subtree is blocked under the normal failure policy. There is no auto-resolution, ever.
- [x] R5. Generated regions: under parallel mode, task pipelines skip the post-record feature sync (new pipeline var `deferFeatureSync`, default `"false"`), so their branches never touch feature files or `docs/features/INDEX.md`. After the last integration, the orchestrator runs the bounded feature sync plus `spur feature refresh --feature <id>` once per touched feature on the base ref, and commits the result as one `chore(corpus)` commit.
- [x] R6. Surface and doc sync:
  - lift the `--worktree --mode parallel` rejection;
  - `--mode parallel` now implies per-task worktrees, and `--worktree` together with it is rejected with the new message "parallel mode already isolates each task in its own worktree";
  - add `--concurrency` to the dev-runall flag table and the glossary;
  - remove the stale 0142 references and the "Parallel execution — needs git-worktree isolation; v1 is sequential" item in `plugins/sp/agents/super-planner.md:276`.

### Acceptance Criteria

- [x] AC1 — R21 Parallel mode runs each concurrent task in its own worktree (req: R1)
  Given a frozen batch with two tasks that have no dependency path between them
  When the operator runs /sp:dev-runall with --mode parallel
  Then each concurrently running task gets its own git worktree and branch cut from the current base ref
  And no two task pipelines ever write to the same working tree
  And a marker under .spur/run records each task worktree's path, branch, base ref, and base SHA
  Verify with a plugin contract test asserting that `execution-batch.md` § Parallel isolation specifies per-task create-mode worktrees, per-task markers with `batchId`, and the no-shared-tree invariant.

- [x] AC2 — R22 Parallel concurrency is bounded and dependents wait for integration (req: R2)
  Given a parallel batch whose independent set is larger than the concurrency bound
  When the batch runs
  Then at most the bound (default 2) task pipelines run at once
  And a dependent task starts only after every in-set dependency has been integrated onto the base ref
  And sequential remains the default when --mode is omitted
  Verify with a contract test over the parallel pseudo-code (bound, the eligibility rule keyed on "integrated") and `command-flag-parity.test.ts` covering `--concurrency` in dev-runall.md + flag-glossary.md.

- [x] AC3 — R23 A finished task integrates by rebase and fast-forward only (req: R3)
  Given a parallel task that succeeded while a sibling was already integrated
  When the orchestrator integrates it
  Then its branch is rebased onto the current base ref tip and fast-forward-merged
  And its worktree and branch are removed after the fast-forward
  And no merge commit is created
  Verify with a scripted git fixture test (temp repo, two branches touching disjoint files, rebase + `--ff-only`, assert linear history and removed worktrees) plus a contract assertion that the integration block uses `rebase` then `merge --ff-only` and never `merge --no-ff`.

- [x] AC4 — R24 An integration conflict retains the task worktree and never auto-resolves (req: R4)
  Given a parallel task whose rebase onto the base ref conflicts
  When the orchestrator integrates it
  Then the rebase is aborted and no conflict resolution is attempted
  And the task worktree and branch are retained and named in the batch report with resume, merge, and discard commands
  And the task's dependent subtree is blocked under the normal failure policy
  Verify with the git fixture test's conflicting case (the rebase fails, `rebase --abort` leaves the worktree clean on its original tip, the branch still exists) and a contract assertion on the `integration-conflict` outcome + report fields.

- [x] AC5 — R25 Generated corpus regions are regenerated once after integration (req: R5, R6)
  Given parallel tasks under the same feature
  When their branches are integrated
  Then no integration conflicts on generated regions such as feature Tasks tables or features INDEX.md
  And the orchestrator regenerates those regions once on the base ref after the last integration
  Verify with a pipeline test that `deferFeatureSync: "true"` skips the record-step feature sync (default unchanged), a contract assertion on the post-integration sync + refresh step, and a grep assertion that no `0142` reference and no "--worktree --mode parallel is rejected ... 0142" wording remains in plugins/sp.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T06:57:42.909Z

- **Isolation model (closed 2026-09-22, operator).** Per-task worktrees with rebase + fast-forward integration, chosen over the rejected alternatives: one shared batch worktree with file-overlap serialization, and merge commits.
- **Default bound (closed).** 2. Each pipeline runs `bun run spur-check` (about 2 minutes, CPU heavy), so beyond 2 the gates contend. The operator can raise it with `--concurrency`. This is a plugin flag, not a public `spur` verb, so no surface consent is needed.
- **`--worktree` with `--mode parallel` (closed).** Still rejected, with a new reason: parallel mode already owns isolation, and reuse mode (`--worktree <name>`) has no per-task meaning. This keeps R8.1's scenario.
- **Generated regions (closed).** Defer the per-task feature sync (`deferFeatureSync` var), then sync and refresh once after integration. Rejected alternatives:
  - a `.gitattributes` merge driver, because it adds infrastructure for a derivable file;
  - resolving generated paths with `--ours`/`--theirs`, because feature files mix generated and authored blocks, so a whole-file side pick can lose authored edits.
- **Deferred.** Resuming a retained parallel batch with `--continue` covers only the sequential marker today. A parallel `--continue` is future work; a retained task is resumed with `/sp:dev-run <wbs> --worktree <branch>`, which already exists.

### Design

- **Where.** Add a new `## Parallel isolation (--mode parallel)` section to `execution-batch.md` that **replaces** the current `## Parallel Execution` section (`:931-949`) and the Step 3 parallel paragraph (`:228-232`). It reuses WT-1…WT-5 by reference and does not copy them.
- **Driver loop (pseudo-code in the section).**
  ```
  WT-1 once on the main tree (dirty → abort)
  ready = topo frontier; running = {}; integrated = set()
  while ready or running:
      while |running| < CONCURRENCY and ready has t with deps(t) ⊆ integrated:
          WT-2 create (sp/run-<t>-<id>) from BASE_REF tip; WT-3 marker {batchId, selector:t}
          RUN[t] = spur workflow run task-pipeline.yaml --vars … --async --json   (workdir = worktree)
      wait for any RUN terminal (trace poll, 0930 bound applies)
      on done:  WT-3b commit → integrate(t) (serialized)
      on failed/paused: WT-5 retain; failure policy (stop default / --keep-going subtree skip)
  post: spur feature refresh --feature <f> for each touched f; commit "chore(corpus): refresh <f> after parallel batch <batchId>"
  ```
  `integrate(t)`: from the main tree, `git -C "$WT" rebase "$BASE_REF"`. On failure, `git -C "$WT" rebase --abort` → WT-5 with `integration-conflict`. Otherwise: `git checkout "$BASE_REF"`, zero-commit guard, `git merge --ff-only "$BRANCH"`, WT-4a/4b/4c, and marker `merged`.
- **Workdir.** `spur workflow run` records the launch workdir (0784 R1). Launch with `cwd` = the task worktree (`cd "$WT" && spur workflow run …`) so resume and verdict paths resolve there. The verdict is read from `$WT/.spur/run/<wbs>-verdict.json` before integration. WT-4a copies it into the invoking tree.
- **Generated regions (verified 2026-09-22).**
  - The only per-task writer of the feature file is the `record` step's post-record feature sync (`config/workflows/task-pipeline.yaml:590`, the `feature-sync-bounded` wrapper, Step 3.3c).
  - `spur task update` does not touch the feature `## Tasks` table: 0800 stayed `testing` there until `feature refresh`.
  - `docs/features/INDEX.md` is written only by `spur feature refresh`.
  - `docs/tasks5/` has no kanban index file.
  - So: add a var `deferFeatureSync: "false"` to `task-pipeline.yaml`'s vars. When it is `"true"`, the line-590 shell appends `feature sync deferred to batch integration` to `.spur/run/$wbs-report.txt` and skips the sync.
  - The parallel orchestrator launches each task with `deferFeatureSync: "true"`. After the last integration, on the base ref, it runs the same bounded wrapper `feature-sync-bounded <f>`, then `spur feature refresh --feature <f>`, for each touched feature, and commits once.
  - Any rebase conflict, on any path, goes to R4. There is no path-based auto-resolution.
  - Sequential and inline runs keep the default `"false"`, so their behavior is unchanged.
- **Report.** Add `integration-conflict` to the outcome vocabulary (`super-planner.md:265`, Step 5). Conflict rows carry `worktree`, `branch`, and the commands `cd <wt> && git rebase <BASE_REF>`, `git merge --ff-only <branch>`, and `git worktree remove <wt> && git branch -D <branch>`.
- **Doc sync (R6):**
  - `execution-batch.md:446-447`, `:872-873`: rewrite WT-7 to the new rejection reason;
  - `:887-891`: leave for 0933;
  - `dev-runall.md:59-61` and flag table: add `--concurrency`;
  - `flag-glossary.md:434-435`: new rejection reason, plus a `--concurrency` entry if two or more commands use it, otherwise a local flag row only;
  - `super-planner.md:274-276`: delete the parallel bullet and describe parallel isolation in one line with a link;
  - `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:40`: trigger 4 links to the new section for task-pipeline fan-out;
  - `plugins/sp/skills/next-feature/references/ranking-rubric.md:43` keeps `0142` only as a historical example; change it to a generic `blocked: <wbs> — external trigger`.
- **Tests.** Add `plugins/sp/tests/parallel-isolation-contract.test.ts` (contract asserts) and `plugins/sp/tests/parallel-integration-git.test.ts` (a temp-repo fixture using `Bun.spawnSync` on `git` inside the test only, following existing plugin test patterns). Also extend `command-flag-parity.test.ts`.
- **Invariants.** Sequential mode stays byte-for-byte unchanged. No merge commits. No auto-resolution outside the generated-path exception. The main tree is never written by a task pipeline. Plugin standalone imports hold.
- **Coordination.** 0930 edits `execution-batch.md` §3.1/§3.3 (trace polling + stale evidence), and D63 0919 edits the same file. This task depends on 0930: rebase onto it before editing, and use its bounded `--timeout` watch in the `wait for any RUN` step.
- **Budget.** About 6 h. Mutation policy: code (plugin docs + tests; one `task-pipeline.yaml` var + guard).
- **Out of scope.** Conflict auto-resolution; parallel `--continue`; `/sp:dev-parallel` review-panel/investigation modes; changing `spur workflow run`.

### Plan

1. Rebase onto 0930. Add the `deferFeatureSync` var + guard in `task-pipeline.yaml:590` (and the `apps/cli/config` bundle via `build:bundle`); extend `plugins/sp/tests/task-pipeline-resilience.test.ts` or the nearest pipeline test to assert the skip.
2. Write failing tests: `parallel-isolation-contract.test.ts` (AC1/2/5 asserts, no-0142 grep), `parallel-integration-git.test.ts` (AC3 linear FF, AC4 conflict retain) and the parity additions.
3. Write the `## Parallel isolation` section (pseudo-code, `integrate()`, conflict path, generated-path exception, report fields), replacing `:228-232` and `:931-949`.
4. Doc sync: WT-7, dev-runall, flag-glossary, super-planner out-of-scope, dispatch-surface trigger 4, ranking-rubric example.
5. `cd plugins/sp && bun test tests/parallel-*.test.ts tests/command-flag-parity.test.ts`, then `bun run spur-check` and `bun run plugin-smoke`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/domain/tests/planning/lifecycle-drift.test.ts:170` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:198` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:271` |
| `plugins/sp/tests/command-flag-parity.test.ts:248` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:2` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:29` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:309` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | diff: `plugins/sp/skills/spur-dev/references/execution-batch.md:965-969` (§ Parallel isolation: own `sp/run-<wbs>-<short-id>` worktree cut from base-ref tip; "Two task pipelines never share a working tree, and the main tree receives no task writes"), `:981-986` (WT-2 create from BASE_REF tip; WT-3 marker `{command: dev-runall, selector: <wbs>, batchId}` over schema fields path/branch/baseRef/baseSha). test: `plugins/sp/tests/parallel-isolation-contract.test.ts:56` "AC1 (R1) — per-task create-mode worktrees, WT-3 markers with batchId, no shared tree" — pass. |
| R2 | MET | diff: `execution-batch.md:981` (`\|running\| < CONCURRENCY`), `:996-1000` (Bound: `--concurrency` default 2, n ≥ 1; Eligibility keyed on deps ⊆ **integrated**, pipeline-terminal not enough; "Omitting `--mode` stays sequential"); `plugins/sp/commands/dev-runall.md:27` (flag-table row, default 2, no-op in sequential); `plugins/sp/skills/spur-dev/references/flag-glossary.md:129-131` (single glossary entry, anchor `#flag-concurrency`). test: `parallel-isolation-contract.test.ts:67` AC2 — pass; `plugins/sp/tests/command-flag-parity.test.ts` 0931 additions (dev-runall table+notes, glossary exactly-once keyed on anchor) — pass. |
| R3 | MET | diff: `execution-batch.md:1006-1022` — `:1009` "integrations are **serialized** (one at a time) in completion order", `:1013-1016` (`git -C "$WT" rebase "$BASE_REF"` re-read per integration → zero-commit guard → `git merge --ff-only "$BRANCH"` → WT-4a verdict persist → WT-4b holders → WT-4c registry), `:1020-1022` ("The merge is always `--ff-only`"; never a merge commit). test: `plugins/sp/tests/parallel-integration-git.test.ts` — AC3 linear history/no merge commits/tree+branch removed (pass), AC3 guard: non-FF base refuses `--ff-only` (pass); `parallel-isolation-contract.test.ts:76` asserts no `--no-ff` anywhere — pass. |
| R4 | MET | diff: `execution-batch.md:1014` (rebase fails → `git rebase --abort` → conflict path), `:1027-1041` (abort leaves worktree clean on its original tip; outcome `integration-conflict`; report rows carry worktree/branch + resume/merge/discard commands; "There is no auto-resolution — not for generated paths, not for anything"), `:438-439` (Step 5 vocabulary gains `integration-conflict`); `plugins/sp/agents/super-planner.md:270-271` (vocabulary + link). test: `parallel-integration-git.test.ts` AC4 conflict case (branch + base intact, clean original tip) — pass; `parallel-isolation-contract.test.ts:87` AC4 — pass. |
| R5 | MET | diff: `config/workflows/task-pipeline.yaml:164` (`deferFeatureSync: "false"` default, sequential/inline unchanged), `:596-602` (record-step guard: deferral note + skip when `"true"`, else delegate to `plugins/sp/scripts/record-feature-sync.ts`); `execution-batch.md:986` (parallel launches pass `deferFeatureSync:"true"`), `:1045-1053` (post-integration: bounded feature sync + `spur feature refresh` once per touched feature on the base ref, one `chore(corpus)` commit; any conflict → R4). test: `plugins/sp/tests/task-pipeline-resilience.test.ts:314` (defer "true" skips the sync and notes the deferral — canary spurBin never invoked) + `:344` (default delegates end-to-end incl. last-resort ladder) — pass; `parallel-isolation-contract.test.ts:99` AC5 — pass. |
| R6 | MET | diff: rejection "parallel mode already isolates each task in its own worktree" at `execution-batch.md:473-475`, `:900-903`, `:1055-1061`; `dev-runall.md:27,44-47,62-64`; `flag-glossary.md:445`; `super-planner.md:277-280` (old "needs git-worktree isolation; v1 is sequential" bullet replaced by isolation one-liner + link); `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:40` (trigger 4 links § Parallel isolation); `plugins/sp/skills/next-feature/references/ranking-rubric.md:43` (generic `blocked: <wbs> — external trigger`). test: `parallel-isolation-contract.test.ts:110` (rejection with new reason everywhere), `:117` (Step 3 routes to the new section; shared-tree wording gone), `:123` (no retired 0142 reference on non-test plugin surfaces) — pass. log: fresh `grep -rn "0142" plugins/sp --include=*.md --include=*.ts --include=*.yaml --include=*.mjs --include=*.json` excluding tests/ → 0 matches. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | test: `parallel-isolation-contract.test.ts:56` AC1 (pass, 105/0 run fresh). diff: `execution-batch.md:965-969,981-986` — per-task create-mode worktrees from base-ref tip, WT-3 markers carrying path/branch/baseRef/baseSha + batchId, no-shared-tree + main-tree-untouched invariants. |
| AC2 | MET | test | test: `parallel-isolation-contract.test.ts:67` AC2 over the pseudo-code (bound + "integrated" eligibility rule) and `command-flag-parity.test.ts` 0931 pair for `--concurrency` in dev-runall.md:27 + flag-glossary.md:129-131 (pass). diff: `execution-batch.md:981,996-1000`. |
| AC3 | MET | test | test: `parallel-integration-git.test.ts` temp-repo fixture (Bun.spawnSync git): two branches touching disjoint files → rebase + `--ff-only` → linear history, 0 merge commits, worktree + branch removed (pass); guard: non-FF base refuses `--ff-only` (pass). diff: `execution-batch.md:1006-1022` (integrate block uses `rebase` then `merge --ff-only`, never `--no-ff`; WT-4a/b/c cleanup). |
| AC4 | MET | test | test: `parallel-integration-git.test.ts` AC4 conflicting case — rebase fails, `rebase --abort` leaves worktree clean on its original tip, branch still exists, base untouched (pass). diff: `execution-batch.md:1014,1027-1041` (`integration-conflict` outcome + report fields + dependent subtree under normal failure policy + no-auto-resolution sentence). |
| AC5 | MET | test | test: `task-pipeline-resilience.test.ts:314,344` (deferFeatureSync "true" skips record-step sync — canary never invoked; default unchanged end-to-end) + `parallel-isolation-contract.test.ts:99` (post-integration sync + refresh + one chore(corpus) commit) + `:123` (no 0142 non-test match) — all pass. log: fresh grep → 0 `0142` matches in non-test plugin sources. diff: `config/workflows/task-pipeline.yaml:164,596-602`; `execution-batch.md:1045-1053`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS-with-findings** — pipeline run d294b3c9, review dimensions: functional traceability, SECUA, architecture. All six requirements (R1–R6) and AC1–AC5 traceable with fresh evidence (full report: `.spur/run/d294b3c9-c41b-4366-9c0c-dce7b1fd035f-review-answer.txt`).

#### Findings

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P2 (major) | architecture | Parallel driver loop dropped the Design's `on failed/paused → WT-5 retain` branch — only done/failed handled; a parallel batch without `--auto` pauses at the approve gate → non-terminal run → 600 s poll timeout with unspecified driver behavior (sequential retains on HITL pause at execution-batch.md:499,:841). Disposition required: restore the one-line paused branch or declare parallel headless/`--auto`-only. | `plugins/sp/skills/spur-dev/references/execution-batch.md:987-989` |
| 2 | P3 (minor) | functional | `### Solution` / `### Testing` sections still placeholders although implementation is complete (sibling 0930 has Solution filled); record's L3 read and the done-gate need them. | `docs/tasks5/0931_isolate-parallel-batch-tasks-in-per-task-worktrees-with-reba.md:163,167` |
| 3 | P3 (minor) | correctness | `batchId` marker field grafted onto WT-3 by prose only; the WT-3 schema (SSOT for WT-6 resume scan + reuse adoption) doesn't declare it. | `plugins/sp/skills/spur-dev/references/execution-batch.md:659-671` vs `:983-985` |
| 4 | P4 (advisory) | correctness | `&& echo \|\| if` fall-through: if the deferral echo fails, the sync runs despite `deferFeatureSync: "true"` (pathological — `.spur/run` exists by record time). | `config/workflows/task-pipeline.yaml:602` |
| 5 | P4 (advisory) | correctness | `feature_id` resolution `??` vs old jq `//` falsy fall-through diverges only for a hypothetical top-level `feature_id: ""` with frontmatter set; today's CLI emits no top-level field (verified on 0931). | `plugins/sp/scripts/record-feature-sync.ts:62` |
| 6 | P4 (advisory) | efficiency | (a) bare-spur last resort removed from the shell — degraded env now skips sync with a note where it previously still ran; (b) resolution ladder duplicated between shell and record-feature-sync.ts — shared `plugins/sp/lib` resolver is a future deepening option. | `config/workflows/task-pipeline.yaml:602`, `plugins/sp/scripts/record-feature-sync.ts:70-86` |

#### Traceability + verification evidence

R1–R6 all MET: isolation/marker/bound/eligibility/integrate/conflict/deferral prose pinned by `parallel-isolation-contract.test.ts` (8 pass); git fixture proves linear FF history, conflict-abort retain, `--ff-only` refusal (`parallel-integration-git.test.ts`, 3 pass); parity + resilience additions pass; doc sync complete with zero `0142` matches in non-test plugin sources. Declared ADR-115 extraction verified: `script-contract-check` 0 violations; `spur workflow validate task-pipeline.yaml` valid with 0 error-level composition findings (changed shell = 9 logical commands, warn band with reason comment; the guard+old chain would have breached the error cap 10). Fresh in this review: 94 + 11 + 25 test assertions, 0 failures.

#### Residual risk and disposition

Residual risk: Finding 1 leaves parallel-without-`--auto` behavior unspecified (contract gap, not code); Findings 4–5 are pathological divergences from the replaced chain. Disposition: PASS-with-findings — disposition Finding 1 (one-line prose restoration or headless-only declaration) and fill Solution/Testing before `record`; Findings 3–6 accept explicitly or fold into the same doc touch-up. No production-code changes required; assertions untouched.

### References

- Feature `docs/features/H1_spur-dev-skill.md` R21–R25 (supersedes 0142 R6.x).
- `plugins/sp/skills/spur-dev/references/execution-batch.md` § Worktree isolation (WT-1…WT-7), Step 3, § Parallel Execution.
- `plugins/sp/commands/dev-runall.md`, `plugins/sp/skills/spur-dev/references/flag-glossary.md`, `plugins/sp/agents/super-planner.md`.
- `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` (git mechanics).
- Prior tasks: 0141 (batch v1), 0477/0496 (`--worktree`), 0701 (WT-3b + zero-commit guard), 0720 (WT-4b holders), 0924 (WT-4c registry).
- Depends on 0930 (bounded watch + stale-evidence rule).

### History

- 2026-09-23T06:58:39.993Z backlog → todo (system)
- 2026-09-24T17:01:07.755Z todo → wip (system)
- 2026-09-24T18:27:21.816Z wip → testing (system)
- 2026-09-24T18:27:38.523Z testing → done (system)

