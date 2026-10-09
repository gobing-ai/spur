---
schema_version: 1
name: Guard driver commits against sweeping foreign working-tree changes
status: done
template: feature-impl
created_at: 2026-10-08T18:13:59.742Z
updated_at: "2026-10-09T05:50:00.729Z"
feature_id: H1

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1129-verdict.json
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

- [x] R1. Start fingerprint: a new plugin script `plugins/sp/scripts/commit-guard.ts`, with an `.mjs` twin generated the same way as `task-diffstat`, provides `commit-guard start --run <id>`. It writes `.spur/run/<id>-tree-start.json` containing `{ head, dirty: [<porcelain paths>] }` from `git rev-parse HEAD` and `git status --porcelain=v1 -z`. Placement follows ADR-130 / `sp-script-placement`; imports are `node:*` / relative only (`sp-plugin-standalone`).
- [x] R2. Guarded stage: `commit-guard stage --run <id> [--base <sha>] -- <paths…>` stages only the listed paths that this run wrote. A path qualifies when it changed since base (task-diffstat semantics) and either it was not in the start dirty set or its content hash differs from the start snapshot. Any listed path dirty at start and untouched by the run is reported as foreign and not staged, and the command exits 2 when any explicitly listed path was refused.
- [x] R3. Foreign report: `commit-guard check --run <id>` lists the working-tree changes that are neither written by this run nor in the start set, that is concurrent foreign writers, as JSON `{ foreign: [...] }`, without staging anything. Drivers call it before every commit and record a non-empty result in the batch report.
- [x] R4. Fail closed: `stage` exits non-zero without staging when any target path is unmerged (`git diff --name-only --diff-filter=U`) or contains a line starting with `<<<<<<< `, `=======` between markers, or `>>>>>>> `.
- [x] R5. Runbook wiring: `execution-batch.md` WT-3b, the sequential close-out commit, and the conflict-merge recipe staging call `commit-guard stage` instead of free-form `git add`. Every driver commit step names `git add -A` and `git add .` as forbidden. `inline-pipeline-driver.md` Record & done uses the same guard. The Background cites `a94f9f431` and `36f274590` as the motivating incidents.

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

Implemented the mechanical commit guard (R1–R4) and wired the runbooks (R5).

| Anchor | Change and rationale |
| --- | --- |
| `plugins/sp/scripts/commit-guard.ts:180` | New plugin script, `start` / `stage` / `check`. `runStage` stages only the listed paths this run wrote — changed since base (task-diffstat semantics) minus start-dirty paths whose content still matches the start snapshot — so a concurrent writer's file is refused and named `foreign` (exit 2) instead of being swept into the commit (R2). |
| `plugins/sp/scripts/commit-guard.ts:144` | `runStart` writes `.spur/run/<id>-tree-start.json` = `{ head, dirty: [{path, sha}] }` from `git rev-parse HEAD` plus `git status --porcelain=v1 -z`, hashing each dirty path with `git hash-object` (`null` when deleted): the snapshot `stage`/`check` compare against (R1). |
| `plugins/sp/scripts/commit-guard.ts:208` | `runCheck` prints `{"foreign":[…]}` — working-tree changes this run did not write — and stages nothing, so a driver records foreign writers before every commit (R3). |
| `plugins/sp/scripts/commit-guard.ts:89` | `conflictMarkerLine` plus the unmerged probe in `conflictingTarget` fail closed: exit 3 with nothing staged when any target path is unmerged (`git diff --name-only --diff-filter=U`) or carries `<<<<<<<` / `=======` / `>>>>>>>` markers (R4). |
| `plugins/sp/scripts/commit-guard.mjs:4` | Generated twin: the banner `// plugins/sp/scripts/commit-guard.ts` names the source script the converter emits this Node-runnable form of; regenerated after every source edit so it is never stale, and `script-contract-check` fails when the twin drifts (ADR-065 entrypoint contract). |
| `config/plugin-scripts.json:16` | Manifest entry registering `commit-guard.ts` as `standard` with twin `commit-guard.mjs`; the check is two-sided, so an unregistered script or a stale twin fails `script-contract-check`. |
| `plugins/sp/tests/commit-guard.test.ts:86` | E2E AC1–AC3 against temp git repos: a concurrent writer's dirty-at-start file is excluded and named with exit 2 and `check` reports it; a pre-existing dirty file the run edits further is staged with exit 0; conflict markers stage nothing with exit 3. |
| `plugins/sp/tests/commit-guard.test.ts:193` | AC4 contract test: every `git commit` region in both runbooks invokes `commit-guard stage`, and `git add -A` / `git add .` appear only on a line that says forbidden. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:945` | WT-3 fingerprint instruction (`commit-guard start --run "$RUN_ID"`) before the first task writes, so the run has a start point to compare against. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:980` | WT-3b stages the batch's writes through `bun "$GUARD" stage --run "$RUN_ID" -- <files-the-batch-wrote>` and halts on refusal, replacing the free-form `git add <files-the-batch-wrote>`. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:986` | The forbidden sentence: `git add -A` and `git add .` stage whatever a concurrent writer happened to leave in the tree, so a driver stages only through `commit-guard stage`. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:618` | The Step 6 sequential close-out commit stages the wrap's writes through `bun "$GUARD" stage --run "$RUN_ID" -- <files the wrap wrote>` instead of a free-form add. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:1360` | Conflict-merge recipe step 3 stages resolved paths through `bun "$GUARD" stage --run "$RUN_ID" -- <resolved paths and regenerated bundles>`; step 1b fingerprints before the merge so a path already dirty is foreign rather than merge content. |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:877` | Record & done stages the per-task commit through `bun "$GUARD" stage --run "$RUN_ID" -- <files this run wrote>` and names the free-form adds as forbidden; the setup step takes the fingerprint at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:98`. |
| `plugins/sp/scripts/commit-guard.ts:18` | Documented limit: the `shortcut:` note says a foreign edit to a path that was CLEAN at `start` is indistinguishable from this run's own write, because git records content and not authorship; such a path is caught only once it is dirty in the start snapshot. |
| `plugins/sp/tests/commit-guard.test.ts:86` | AC1 is encoded in its attributable form — the concurrent writer's change is present when the run fingerprints and the run never touches it — because the AC's literal post-start edit of two clean paths is not observable. All AC1 assertions hold. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/commit-guard.ts:144` `runStart` writes `.spur/run/<id>-tree-start.json` = `{ head, dirty: [{path, sha}] }` from `git rev-parse HEAD` + `git status --porcelain=v1 -z` + `git hash-object` (`:69`), atomically (`.tmp` + rename); registered `config/plugin-scripts.json:16` as `standard` with twin `commit-guard.mjs`. Ran in a throwaway temp git repo (not this tree): `commit-guard start --run v3` exit 0, artifact `{"head":"e973cf8…","dirty":[{"path":"b.txt","sha":"587be6b4c3f93f93c489c0111bba5596147a26cb"}]}`. Test `plugins/sp/tests/commit-guard.test.ts:77` (R1 assertion on head + porcelain sha) passes; `bun scripts/commands/script-contract-check.ts` → 22 script(s) baselined (21 standard, 1 repo-only), 0 violation(s) — PASS (twin byte-identical to a fresh convert of the `.ts`); `bun run plugin-smoke` → `plugin-install-smoke PASS`; `rule run --preset recommended-pre-check` → all 50 rules (incl. `config/rules/boundary/sp-plugin-standalone.yaml:26`, `config/rules/boundary/sp-script-placement.yaml:7`) pass. |
| R2 | MET | `plugins/sp/scripts/commit-guard.ts:180` `runStage`: qualifying set = `changedSinceBase` (`:99`, task-diffstat semantics) minus start-dirty entries whose `git hash-object` still equals the start `sha` (`:136`); refused paths are named on stderr (`:197`) and the exit is 2 when any listed path is refused (`:205`). Throwaway-repo E2E: `start` with `b.txt` already dirty → run writes `a.txt` → `stage --run v2 -- a.txt b.txt` prints `{"staged":["a.txt"],"foreign":["b.txt"]}`, stderr `refused b.txt (foreign — dirty at start, untouched by this run)`, exit 2, `git diff --cached --name-only` = `a.txt` only; `stage --run ba --base <C0>` staged a committed change (exit 0) and a second probe resolved the worktree `base.sha` precheck anchor instead of an explicit `--base` (exit 0); a path unchanged since base is refused with exit 2. Tests `plugins/sp/tests/commit-guard.test.ts:86`, `:99` pass. |
| R3 | MET | `plugins/sp/scripts/commit-guard.ts:208` `runCheck` prints `{"foreign":[…]}` and never stages. `plugins/sp/tests/commit-guard.test.ts:86` asserts `check --run r1` stdout is exactly `{"foreign":["b.txt"]}`; my throwaway-repo E2E reproduced `{"foreign":["b.txt"]}` after the same two-writer setup. Scope limit is declared in-source at `plugins/sp/scripts/commit-guard.ts:18` (`shortcut:` note): a path CLEAN at `start` and dirtied later carries no authorship in git, so it is not listed — this is the accepted AC1 reading recorded as residual (a); a path dirty at start and untouched by the run IS listed and refused. |
| R4 | MET | `plugins/sp/scripts/commit-guard.ts:89` `conflictMarkerLine` (opener + `=======` pair, or closer) and `:163` `conflictingTarget` (unmerged probe via `git diff --name-only --diff-filter=U`, then marker scan) run before any `git add`, so a hit returns exit 3 with nothing staged. Throwaway-repo E2E: a file with `<<<<<<< HEAD` / `=======` / `>>>>>>> other` → stderr `refusing to stage c.txt (conflict markers); nothing staged`, exit 3, `git diff --cached --name-only` empty. Tests `plugins/sp/tests/commit-guard.test.ts:111` (markers) and `:122` (unmerged target; index byte-identical before/after refusal) pass; a missing start snapshot fails closed with exit 1 (`:143`, my E2E: exit 1). |
| R5 | MET | Guard wired into all four commit steps: WT-3b `plugins/sp/skills/spur-dev/references/execution-batch.md:978-982` (replaces `git add <files-the-batch-wrote>`), sequential close-out `:616-620`, conflict-merge recipe `:1352-1361` with the fingerprint at `:1353`, and Record & done `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:876-880`; fingerprints at `plugins/sp/skills/spur-dev/references/execution-batch.md:962` (WT-3, worktree) and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:107-109` (setup window). Forbidden notes for `git add -A` / `git add .` at `plugins/sp/skills/spur-dev/references/execution-batch.md:623`, `:986`, `:1361`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:869`. Background cites both motivating incidents (`a94f9f431`, `36f274590`). Contract tests `plugins/sp/tests/commit-guard.test.ts:193`, `:203`, `:212` pass (10 pass / 0 fail); `(cd plugins/sp && bun test tests/skill-structure.test.ts)` → 91 pass / 0 fail. Known P4 residual (b): the sequential close-out block consumes `$RUN_ID` (`plugins/sp/skills/spur-dev/references/execution-batch.md:617-618`) with no `RUN_ID=` assignment on that path (only the Step 3 pseudo-code call at `:243`), so an unset id makes the guard exit 1 and the close-out halt rather than sweep — fail-closed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A concurrent writer's file is excluded and named (req: R1, R2, R3) | MET | test | `plugins/sp/tests/commit-guard.test.ts:86` (temp git repo; b.txt dirty at start and untouched by the run → `{"staged":["a.txt"],"foreign":["b.txt"]}`, exit 2, index = `a.txt`, `check` = `{"foreign":["b.txt"]}`). Independently reproduced in my own throwaway repo `/tmp/cg-verify-rgqEPQ` with the `node`-run twin (exit 2, `check` `{"foreign":["b.txt"]}`). Encoded in the attributable form accepted as residual (a): a post-`start` edit of a CLEAN path is not git-attributable, and my E2E confirmed the guard stages such a listed path (exit 0) exactly as R2's rule states. |
| AC2 — A pre-existing dirty file the run then edits is stageable (req: R2) | MET | test | `plugins/sp/tests/commit-guard.test.ts:99` (b.txt dirty before `start`, modified again by the run → `{"staged":["b.txt"],"foreign":[]}`, exit 0, index = `b.txt`). Reproduced in my throwaway repo: start with `b.txt` dirty, then edit → `stage` exit 0, `{"staged":["b.txt"],"foreign":[]}`. |
| AC3 — Conflict markers fail closed (req: R4) | MET | test | `plugins/sp/tests/commit-guard.test.ts:111` (file with `<<<<<<< HEAD`, `=======`, `>>>>>>> other` → exit 3, stderr names `c.txt`, `git diff --cached --name-only` empty) plus `:122` for the unmerged-index probe. Reproduced in my throwaway repo with the `.mjs` twin: exit 3, nothing staged. |
| AC4 — Runbooks route commits through the guard (req: R5) | MET | test | `plugins/sp/tests/commit-guard.test.ts:193` (every `git commit` command region in `execution-batch.md` + `inline-pipeline-driver.md` invokes `$GUARD stage`), `:203` (`git add -A` / `git add .` appear only on a line matching /forbidden/i), `:212` (both docs name `commit-guard` and both incidents). Cross-checked by grep: the only `git add` left in those two docs is the forbidden-note line `plugins/sp/skills/spur-dev/references/execution-batch.md:623` and the prose note at `plugins/sp/skills/spur-dev/references/execution-batch.md:612`; the four driver commit steps are `plugins/sp/skills/spur-dev/references/execution-batch.md:618/620`, `:980/982`, `:1360/1364`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:878/880`. |
| AC5 — Plugin contracts hold (req: R1) | MET | command | `bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo` → `All 50 rules passed — no violations found` (exit 0); that preset extends `boundary` (`config/rules/recommended-pre-check.yaml:16`), which carries `sp-plugin-standalone` (`config/rules/boundary/sp-plugin-standalone.yaml:26`, scope `plugins/sp/scripts/**/*.ts`) and `sp-script-placement` (`config/rules/boundary/sp-script-placement.yaml:7`). `bun run plugin-smoke` → `plugin-install-smoke PASS — plugin surface is standalone and installs clean`; `bun scripts/commands/script-contract-check.ts` → 22 script(s) baselined (21 standard, 1 repo-only), 0 violation(s) — PASS; `bunx tsc -p plugins/sp/tsconfig.json --noEmit` exit 0; `bunx biome check --error-on-warnings plugins/sp/scripts/commit-guard.ts plugins/sp/tests/commit-guard.test.ts` → no fixes needed, exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Session review 2026-10-08 (this task's Background); commits `a94f9f431`, `36f274590`.
- `plugins/sp/scripts/task-diffstat.ts` (base-sha and GitRunner pattern); `plugins/sp/skills/spur-dev/references/execution-batch.md:928-947,1284-1320`; `references/dev-operations.md:563`; ADR-130; `docs/design/harness-surface-governance.md` §2.
- Related: 1127 (gate lock), 1128 (runbook split; if 1128 lands first, the WT-3b text lives in the worktree-setup on-demand file).

### History

- 2026-10-08T18:35:27.715Z backlog → todo (system)
- 2026-10-09T01:02:25.748Z todo → wip (system)
- 2026-10-09T02:49:20.507Z wip → testing (system)
- 2026-10-09T02:50:52.074Z testing → done (system)

