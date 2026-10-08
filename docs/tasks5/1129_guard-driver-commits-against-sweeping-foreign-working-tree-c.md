---
schema_version: 1
name: Guard driver commits against sweeping foreign working-tree changes
status: todo
template: feature-impl
created_at: 2026-10-08T18:13:59.742Z
updated_at: "2026-10-08T18:35:27.715Z"
feature_id: H1

ac_numbering: task-local
ac_altitude: task-local
---

## 1129. Guard driver commits against sweeping foreign working-tree changes

### Background

The fleet shared one main checkout while drivers committed into it. Two contaminations are baked into history: the P1 batch driver's pipeline commit swept the F91 session's uncommitted files into `a94f9f431`, and the F91 close-out commit `36f274590` swept two P1 files (`task-pipeline.yaml`, an i31 report) through `git add -A`. A concurrent writer also left conflict markers in `packages/app/src/services/workflow-service.ts:2099` mid-close-out, breaking the CLI until it self-resolved. H15 timed-out children dispatched without `cwd` edited the main tree (`proof-chain.test.ts`, `apps/cli/tests/commands/agent.test.ts`).

The runbook already says to stage only batch-written files (`plugins/sp/skills/spur-dev/references/execution-batch.md:941`) and AGENTS.md says one writer per tree, but nothing enforces it. The missing dispatch `cwd` rule was added to `inline-pipeline-driver.md` as a direct fix in this review; this task covers the mechanical guard.

**Evidence detail (session review 2026-10-08, HIGH confidence; both are git objects):**
- `git show --stat a94f9f431` ("feat: add sourced-api-claims advisory rules"): 4 files, including `config/rules/*`. These were the F91 session's uncommitted files, committed by the P1 batch driver.
- `git show --stat 36f274590` ("test(app): … (1118 AC1)"): includes `config/workflows/task-pipeline.yaml` and `docs/reports/i31/1107-runall-p1-pilot.md`, which are P1's files, swept in by F91's close-out `git add -A`.
- Neither commit is rewritten by this task; history rewrite needs separate operator authorization. Requirement R5 only records them.

**Reusable pieces already in the tree (do not reinvent):**
- `.spur/run/<wbs>-base.sha` is written once by the pipeline `precheck` (F96 R1) and is the run's anchored base commit.
- `plugins/sp/scripts/task-diffstat.ts` already computes "paths changed since base" (`git diff --numstat <base>` plus `git ls-files --others --exclude-standard`) with an injectable `GitRunner` and node-builtin imports only. Its path collection is the base for the guard's "written by this run" set.
- `plugins/sp/scripts/batch-preflight.ts` is readiness-only today and takes no fingerprint.
- `references/dev-operations.md` `### 9. gitmsg` (line 563) already uses scope-limited `git add -A -- <group paths>`. That is the correct shape; the batch runbook's WT-3b (`execution-batch.md:928-947`, `git add <files-the-batch-wrote>` at 941) and the conflict-merge recipe staging (about lines 1284–1320) are prose instructions with no mechanical check.

### Requirements

- [ ] R1. Start fingerprint: a new plugin script `plugins/sp/scripts/commit-guard.ts`, with an `.mjs` twin generated the same way as `task-diffstat`, provides `commit-guard start --run <id>`. It writes `.spur/run/<id>-tree-start.json` containing `{ head, dirty: [<porcelain paths>] }` from `git rev-parse HEAD` and `git status --porcelain=v1 -z`. Placement follows ADR-130 / `sp-script-placement`; imports are `node:*` / relative only (`sp-plugin-standalone`).
- [ ] R2. Guarded stage: `commit-guard stage --run <id> [--base <sha>] -- <paths…>` stages only the listed paths that this run wrote. A path qualifies when it changed since base (task-diffstat semantics) and either it was not in the start dirty set or its content hash differs from the start snapshot. Any listed path dirty at start and untouched by the run is reported as foreign and not staged, and the command exits 2 when any explicitly listed path was refused.
- [ ] R3. Foreign report: `commit-guard check --run <id>` lists the working-tree changes that are neither written by this run nor in the start set, that is concurrent foreign writers, as JSON `{ foreign: [...] }`, without staging anything. Drivers call it before every commit and record a non-empty result in the batch report.
- [ ] R4. Fail closed: `stage` exits non-zero without staging when any target path is unmerged (`git diff --name-only --diff-filter=U`) or contains a line starting with `<<<<<<< `, `=======` between markers, or `>>>>>>> `.
- [ ] R5. Runbook wiring: `execution-batch.md` WT-3b, the sequential close-out commit, and the conflict-merge recipe staging call `commit-guard stage` instead of free-form `git add`. Every driver commit step names `git add -A` and `git add .` as forbidden. `inline-pipeline-driver.md` Record & done uses the same guard. The Background cites `a94f9f431` and `36f274590` as the motivating incidents.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A concurrent writer's file is excluded and named (req: R1, R2, R3)
  Given a temp git repo with a committed file a.txt and b.txt
  And `commit-guard start --run r1` has run
  When the run edits a.txt, another process edits b.txt, and `commit-guard stage --run r1 -- a.txt b.txt` runs
  Then only a.txt is staged, b.txt is reported foreign, and the exit code is 2
  And `commit-guard check --run r1` returns foreign = ["b.txt"]

Scenario: AC2 — A pre-existing dirty file the run then edits is stageable (req: R2)
  Given b.txt is dirty before `commit-guard start --run r2`
  When the run modifies b.txt further and stages it through the guard
  Then b.txt is staged and the exit code is 0

Scenario: AC3 — Conflict markers fail closed (req: R4)
  Given a run-written file containing a line `<<<<<<< HEAD`
  When `commit-guard stage` targets it
  Then nothing is staged and the exit code is non-zero naming the file

Scenario: AC4 — Runbooks route commits through the guard (req: R5)
  Given execution-batch.md and inline-pipeline-driver.md after the change
  When a contract test greps their commit steps
  Then every driver commit step invokes `commit-guard stage`, and `git add -A` / `git add .` appear only in a "forbidden" sentence

Scenario: AC5 — Plugin contracts hold (req: R1)
  Given the new script and its twin
  When `bun run apps/cli/src/index.ts rule run` (sp-plugin-standalone, sp-script-placement) and `bun run plugin-smoke` run
  Then both pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T18:35:04.662Z

- **Why not worktree-per-driver as the fix?** That is the right topology (AGENTS.md "one writer per tree"), and `--worktree` exists. But operators ran several pi drivers in one checkout anyway, and a guard catches it mechanically whichever topology is used. Worktree-per-driver stays the recommendation in the runbook.
- **Why content hash for start-dirty paths?** A path dirty at start may be edited by both this run and a foreign writer. Path membership alone would either refuse a legitimate edit (AC2) or sweep a foreign one. Comparing the hash against the start snapshot is the cheapest correct signal. Ponytail ceiling: hunks interleaved by two writers in the same file cannot be separated, so the guard stages the file and the foreign check lists it as shared. Upgrade path: `git add -p` hunk filtering if this ever recurs.
- **Rewrite the two contaminated commits?** No. They are on `main`; a rewrite needs explicit operator authorization and is out of scope.

### Design

- **Script.** `plugins/sp/scripts/commit-guard.ts` uses subcommands `start | stage | check` and reuses task-diffstat's `GitRunner` injection shape so tests fake git. The start snapshot stores `{ head, dirty: [{ path, sha }] }`, where `sha` is from `git hash-object` of the working file (`null` if deleted).
- **Written-by-run set.** Paths changed since `--base` (default `.spur/run/<wbs>-base.sha`, else start `head`), minus start-dirty paths whose hash is unchanged.
- **Exit codes.** 0 = staged all requested; 2 = some refused as foreign; 3 = conflict or unmerged (nothing staged); 1 = mis-invocation.
- **Runbook text.** Replace `git add <files-the-batch-wrote>` with `bun "$SP/scripts/commit-guard.mjs" stage --run "$RUN_ID" -- <files>` (use the same plugin-path resolution the runbook already uses for task-diffstat) and add the one-line forbidden note.
- **Tests.** `plugins/sp/tests/commit-guard.test.ts` runs E2E against a temp git repo (AC1–AC3). The contract grep (AC4) goes in the existing `execution-batch-contract.test.ts`.

### Plan

1. Write `plugins/sp/tests/commit-guard.test.ts` with AC1–AC3 against a temp repo; it fails because the script is missing.
2. Implement `commit-guard.ts` (start/stage/check) and generate the `.mjs` twin the same way task-diffstat's twin is produced.
3. Wire the runbooks (R5) and extend `execution-batch-contract.test.ts` for AC4.
4. Run the rule gate, `bun run plugin-smoke`, `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Session review 2026-10-08 (this task's Background); commits `a94f9f431`, `36f274590`.
- `plugins/sp/scripts/task-diffstat.ts` (base-sha and GitRunner pattern); `plugins/sp/skills/spur-dev/references/execution-batch.md:928-947,1284-1320`; `references/dev-operations.md:563`; ADR-130; `docs/design/harness-surface-governance.md` §2.
- Related: 1127 (gate lock), 1128 (runbook split; if 1128 lands first, the WT-3b text lives in the worktree-setup on-demand file).

### History

- 2026-10-08T18:35:27.715Z backlog → todo (system)

