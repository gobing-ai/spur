---
schema_version: 1
name: Cut per-test child-process cost in the subprocess-lane root test files
status: done
template: standard
created_at: 2026-11-27T19:06:07.059Z
updated_at: "2026-11-28T01:59:02.333Z"

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 8
done_forced: "true"
done_reason: "R1-R5 MET and the review is PASS; the only unmet clause is AC3's 'root suite exits 0', which fails identically on the base commit (packages/app/src/services/a2a-remote-dialog.ts at 80% function coverage against the 90% per-file gate, before-root.log:328) and is outside this task's scope. The pipeline run itself ended failed/retry-exhausted after its second remediate visit exhausted qualityGateMaxFixAttempts while re-routing on the review's P4-only findings; the work was already complete and gated PASS on this tree."
---

## 1475. Cut per-test child-process cost in the subprocess-lane root test files

### Background

Task 1460 (cancelled 2026-11-27) measured the laned root suite and falsified scheduling as the lever:
single child `--parallel=2` 519 s; subprocess lane alone at width 4 286 s; the subprocess-lane files
carry ~96% of wall time and are latency-bound on spawned children (1460 `### Solution`, recorded in
`docs/tasks5/1460_*`; H161 re-scope note `docs/features/H161_*.md:57`). Its follow-up names the real lever:
per-test child cost — `spur` CLI startup, `git`, nested `bun` — in those files.

Current tree (2026-11-27, `f2fdcc354`):

- `config/test-lanes.json` `root.subprocess` lists **145** files (133 `direct`, 12 via helpers such as
  `apps/cli/tests/helpers.ts#runCli`), summed recorded `durationMs` ≈ 1,112 s.
- The cost is concentrated: the top 12 files sum ≈ 650 s (~58%) — led by
  `apps/cli/tests/script-absorption-pr5-parity.test.ts` (89 s), `apps/cli/tests/commands/self/init.test.ts`
  (87 s), `packages/app/tests/workflow/wrapup-pipeline.test.ts` (64 s), `script-absorption-pr6-parity` (59 s),
  `commands/self/status.test.ts` (49 s), `wrapup-pipeline-e2e` (49 s), `commands/builder/show-branches.test.ts`
  (47 s), `plugins/sp/tests/hooks/context-hooks.test.ts` (47 s).
- Spawn kinds across the 145 files (static grep): nested bun/`process.execPath` 52, `git` 45,
  CLI entry (`SPUR_CLI` / `apps/cli/src/index.ts` / `runCli`) 34, `sh -c` 21.
- An in-process seam already exists: `main(argv, { cwd, env, output, dbUrl, db })`
  (`apps/cli/src/index.ts:69`, `MainOptions` `:44-53`), and `runCli`'s own doc says to prefer it unless
  subprocess isolation or real exit codes are required (`apps/cli/tests/helpers.ts:55-65`).
- Lane membership is generated and drift-checked: `scripts/commands/test-lanes.ts` (`--check` runs in
  `repo-wide-tests/test-lanes-manifest.test.ts`, feature H161 R2), so converting a file to in-process
  changes its classification and the manifest must be regenerated in the same change.

**Refine corrections (2026-11-27)**

- "144 subprocess-lane files" → the manifest now lists 145 → R1 uses the live manifest count.
- "measure across the 144 files" as an undifferentiated sweep → cost is top-heavy (12 files ≈ 58%) →
  scope is the measured top contributors, not all 145.
- "old H161 250 s target" as context → no wall-time target is set here; 1460 showed a fixed target on
  this host is a trap → AC uses relative before/after deltas on the same host.

### Requirements

- [x] R1. A before-receipt at `.spur/run/spawn-cost/before.json` records, for every `root.subprocess` file in `config/test-lanes.json`: wall ms (file run alone), test count, and child-process count by kind (`spur-cli`, `git`, `bun`, `sh`, other), produced by a repeatable command checked into the task's Testing section.
- [x] R2. The top contributors from R1 — files in descending wall-ms order until ≥50% of the summed subprocess-lane wall time is covered — have their avoidable children removed: CLI spawns replaced by in-process `main()` where the test asserts no process-level behaviour, and repeated per-test git fixture setup replaced by a per-file template repo copied per test.
- [x] R3. No assertion is weakened, no timeout raised, no test skipped or moved out of the root suite; each touched file's test count is unchanged.
- [x] R4. `config/test-lanes.json` is regenerated (`test-lanes` without `--check`) and `--check` passes.
- [x] R5. An after-receipt (same command, same host) at `.spur/run/spawn-cost/after.json`, plus a before/after root `bun run test` wall-time pair, are cited in Testing.

**Out of scope:** files where the child **is** the behaviour (hook scripts under `plugins/sp/hooks`, exit-code/signal/stdin tests, config-layering tests that need a fresh process); launcher/lane scheduling (`scripts/commands/run-tests.ts`); new dependencies; changes to production code beyond what an in-process call requires.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A per-file spawn-cost receipt ranks the subprocess lane (req: R1)
  Given the current config/test-lanes.json root.subprocess list
  When the measurement command runs
  Then .spur/run/spawn-cost/before.json has one row per listed file with wall ms, test count and child counts by kind
  And re-running the command produces the same file set and child counts

Scenario: AC2 — The top contributors drop their avoidable children (req: R2, R3)
  Given the top files covering at least 50% of summed subprocess-lane wall time in before.json
  When the after-receipt is taken on the same host
  Then the summed wall ms of those files is at least 40% lower than before
  And each touched file's test count equals its before count
  And the diff adds no skip, no raised timeout and no removed expect

Scenario: AC3 — The lane manifest and root suite stay honest (req: R4, R5)
  Given the converted files
  When test-lanes --check and bun run test run
  Then the manifest check passes on the regenerated config/test-lanes.json
  And the root suite exits 0 with wall time below the before-run on the same host, both values cited in Testing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T20:23:30.440Z

- **Closed — target metric:** relative (≥40% on the touched files, root wall time strictly lower), not an absolute wall time; 1460 showed absolute targets on this host are unattainable traps.
- **Closed — scope:** top contributors covering ≥50% of summed wall time (≈12 files today), not all 145.
- **Closed — lever:** in-process `main()` (existing seam) and per-file git template repos; no shared long-lived CLI daemon (new infrastructure, cross-test state).
- **Proposal (not applied) — feature link:** H161 (its re-scope note names this lever as the follow-up); link needs operator confirmation.

### Design

**WHAT.** Measure, then remove avoidable child processes from the heaviest subprocess-lane files.

**Measurement (R1) — frozen names.** A scratch-free preload `scripts/commands/spawn-cost-preload.ts`
wraps `Bun.spawn` / `Bun.spawnSync` (and `node:child_process` `spawn`/`spawnSync`/`execSync`/`execFileSync`)
to count children by kind from argv[0]/argv[1] (`spur-cli` when argv contains `apps/cli/src/index.ts` or
the bundled `spur.js`; `git`; `bun`; `sh`; `other`) and appends one JSON line per file to
`$SPUR_SPAWN_COST_OUT`. The driver is a new `test-lanes` flag: `bun scripts/spur-dev.ts test-lanes
--spawn-cost <out.json>` runs each `root.subprocess` file alone inside its workspace (`bun test
--preload <preload> <file>`), records wall ms and test count, and writes the sorted receipt. It reuses
`readLaneManifest` and the workspace resolution already in `scripts/commands/test-lanes.ts`; it does not
touch classification. (A repo script under `scripts/commands` is the ADR-130 home for repository-policy
tooling; no public `spur` verb.)

**Conversion (R2), per file, in this order of preference:**
1. **CLI spawn → `main(argv, { cwd, env, output })`** (`apps/cli/src/index.ts:69`) with a captured
   `CommandOutput`, when the assertion is on stdout/stderr/JSON/exit code returned by `main`. Keep the
   spawn when the test asserts process lifecycle: real `process.exit`, signals, stdin piping, natural
   shutdown flushing, or project-config layering that `tests/setup.ts`'s `SPUR_SKIP_PROJECT_CONFIG` would mask
   (see `helpers.ts:72-76`) — unless that env is passed explicitly.
2. **Per-test `git init` + commits → per-file template.** Build the fixture repo once in `beforeAll`,
   `cp -R` (or `git clone --local --shared`) per test. Each test still gets its own working tree.
3. **Nested `bun` / `sh` children** stay unless they only wrap a pure function the test can import.

**Invariants.** Test names and counts unchanged; every `expect` preserved (a converted assertion may change
its source — `main` return vs `proc.exited` — but not its claim); per-test isolation preserved (fresh tmp
dir per test, no shared mutable fixture).

**Anti-patterns.** No shared long-lived CLI server/daemon; no raising `timeout` or `--timeout`; no
`test.skip`/`todo`; no moving files to `test:heavy`; no edits to `run-tests.ts` lane scheduling; no
in-process conversion of `plugins/sp/hooks` tests (the standalone-script contract is the behaviour).

**Files.** `scripts/commands/test-lanes.ts` (+ `scripts/commands/test-lanes.test.ts`),
`scripts/commands/spawn-cost-preload.ts`, the selected test files, `config/test-lanes.json` (regenerated).
Possibly a small shared helper in `apps/cli/tests/helpers.ts` (`runMain(args, cwd, env)` returning
`CliResult`) so conversions are one-line swaps — reuse `CliResult`.

**Dependencies.** None in `dependencies[]`. Relies on H161 R2's manifest/drift check (task 1459, done).
**Concurrency.** Worktree `spur-new-runall-1464-1472-aedfe887` touches none of the likely files
(checked 2026-11-27); re-check `git worktree list` before converting each file.

### Plan

0. Precondition: tree clean; `bun install` matches the lockfile; note host (`sysctl -n hw.ncpu`) in Testing. Subprocess tests may need to run outside the agent sandbox.
1. Add `scripts/commands/spawn-cost-preload.ts` and the `test-lanes --spawn-cost <out>` driver; test the receipt shape + child-kind classification in `scripts/commands/test-lanes.test.ts` first.
2. Take `before.json` (AC1) and one before root `bun run test` wall time; run the driver twice to confirm stable child counts.
3. Select the top files covering ≥50% of summed wall ms; for each, list its spawn sites and classify keep/convert per Design rule 1–3 (record the keep reasons in Solution).
4. Add `runMain` to `apps/cli/tests/helpers.ts` if ≥2 files need it; convert file by file, running each file alone after its change (`(cd <ws> && bun test <file>)`) and diffing test counts.
5. Regenerate `config/test-lanes.json`; run `bun scripts/spur-dev.ts test-lanes --check`.
6. Take `after.json` and the after root `bun run test` wall time on the same host; verify AC2/AC3 deltas; cite both in Testing.
7. `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| `scripts/commands/spawn-cost-preload.ts` (new, 1–133) | Child counter for R1: `classifySpawnKind` buckets each child (`spur-cli`/`git`/`bun`/`sh`/`other`) from argv, `tallySpawnLines` sums the `{kind}` lines, `installSpawnCostCounter` wraps `Bun.spawn`/`Bun.spawnSync` (Bun's `node:child_process` is a shim over them) and `Bun.$` with a re-entrancy guard so a shimmed child counts once. One line per child instead of a flush at exit: Bun's test runner exits without emitting process exit events. Inert without `SPUR_SPAWN_COST_OUT`, so the driver's tests can import it. |
| `scripts/commands/test-lanes.ts` (84–357) | R1 measurement: `--spawn-cost <out.json>` (202) runs every `root.subprocess` file alone in its own workspace under the preload, recording wall ms, test count, exit code and per-kind children; `renderSpawnCostReceipt` (276) sorts by wall time then path so "top contributors until ≥50%" is reproducible; `workspaceOf` (257) picks the bunfig the file runs under. |
| `scripts/commands/test-lanes.test.ts` | Written first: kind classification, line tallying (junk → `other`), receipt ordering and per-kind totals. |
| `apps/cli/tests/helpers.ts` (120–186) | `runMain`: the R2 lever. Same `CliResult` shape as `runCli`, but runs `main()` in process. It redirects both write surfaces (the injected `CommandOutput` **and** ts-utils' default `echo`/`echoError` targets, which diagnostics bypass to), emulates the child's process state for the call (env, `realpath`ed cwd, module graph loaded under the case env), releases the decision-service singletons afterwards, and restores everything. `runCli` stays for cases that assert process-level behaviour. |
| `apps/cli/tests/fixtures/script-absorption-pr5/harness.ts` (151–215) | Steps run through `runMain` + `replaceEnv` (`runCase` is async); the 41 golden cases compare byte-for-byte, so the conversion is proved by the fixture rather than asserted. |
| `apps/cli/tests/script-absorption-pr{6,7}/harness.ts` (27–, 24–) | Same conversion; `readBack` is read after the run. The retired-script side (and its `capture.ts` driver) is deleted: its targets no longer exist, and the unreachable branch dragged the harness's per-file line coverage below the 90% gate. The golden fixtures keep their `source` provenance note. |
| `apps/cli/tests/commands/self/init.test.ts` (14, 34) | `runCli` → `runMain` at the shared helper, so all 72 cases stop paying a `bun` boot + migrations per `self init`. |
| `apps/cli/tests/commands/builder/artifacts.e2e.test.ts` (49–51) | In-process with `replaceEnv`; nested `bun` builds the verbs start stay real children. `bundle-laya-worker` keeps `runCli`: the verb resolves `@gobing-ai/ts-laya-mlx` through `Bun.resolveSync` against the running process's module graph, which a fixture checkout cannot stand in for. |
| `apps/cli/tests/commands/builder/show-branches.test.ts` (66–98) | The 29 CLI invocations run in process (all awaited), and the per-test git fixture became a per-file template: one repo is built once and copied per test — commit ids and the `v0.1.0` tag survive, and a filesystem copy (not `git clone`) keeps the fixture remote-less so the default base stays `main`. Identity moves to `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env, which a copy cannot inherit from local config. |
| `plugins/sp/tests/helpers/cli-surface.ts` (102–178) + `plugins/sp/tests/helpers/cli-surface-capture.ts` (new, 1–47) | 146 separate `--help` boots become one: the child boots the CLI once and emits every command path's help text as a JSON map. `captureCliSurface` keeps its synchronous contract, provenance and failure shape, with a per-path spawn fallback for a path the batch does not know. |
| `config/test-lanes.json` | Regenerated (R4): the three parity files leave the subprocess lane because they no longer spawn; `test-lanes --check` passes. |

**Keeps (documented, not converted).**

| File | Why the child stays |
| --- | --- |
| `plugins/sp/tests/hooks/context-hooks.test.ts` | The hook scripts under test *are* the behaviour (task out-of-scope list: `plugins/sp/hooks`). |
| `packages/app/tests/{workflow/wrapup-pipeline, workflow/wrapup-pipeline-e2e, workflow/task-pipeline-proof-chain, rules/coverage-certification}.test.ts` | `packages/app` may not import `apps/cli` (ADR-021 workspace graph), so these suites can only reach the CLI as a child; `coverage-certification` additionally runs the real launcher by contract. |
| `apps/cli/tests/commands/self/exec.test.ts` | The transport seam — inherited stdio, exit codes, stderr step echoes — is what the suite exists to prove. |
| `apps/cli/tests/commands/self/status.test.ts` | The fixture HOME is boot-time process state: `os.homedir()` is read once at process start, so an in-process run cannot honour it (verified: the configuration/decisions sections diverged). |
| `apps/cli/tests/commands/self/install.e2e.test.ts` | Same HOME dependency (install roots) plus real installer children from a fixture `PATH`. |

**Measured result.** `.spur/run/spawn-cost/before.json` (base tree, same host) ranks 145 files, 1196 s summed; the files covering ≥50% of that sum are 12, summing 613 s. Their rows on the final tree sum 170 s — a **72% reduction** (AC2 asks ≥40%); the 3 parity files that left the lane entirely are read from `after-pre-template.json` (4 s / 1 s / 0 s), and the earlier, pre-git-template `after.json` pass gave the conservative 58% on the same set. Restricting to the 142 files still in the subprocess lane: 996 s before → 514 s after (−48%). Every touched file's test count is unchanged (35/32/34/72/16/3/17; show-branches 32 pass + 2 env-failing = 34 → 34) and no skip, raised timeout or removed expectation was added. Root `bun run test` on the same host: **788 s → 398 s (−49%)**, both runs reporting `0 fail` and both exiting 1 on the pre-existing `packages/app/src/services/a2a-remote-dialog.ts` per-file coverage breach (80% functions), which is present at base (`before-root.log:328`) and untouched here.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/spawn-cost-preload.ts:66` classifies a child by argv, `:96` installs the wrappers (`Bun.spawn`/`Bun.spawnSync`/`Bun.$`, re-entrancy guarded so Bun's `node:child_process` shim counts once), `:41` tallies; `scripts/commands/test-lanes.ts:305` is the `--spawn-cost <out.json>` driver (each file run alone in its workspace; wall ms + `testCount` + per-kind children) and `:276` the receipt renderer. `before.json` holds 145 rows; two repeat runs on one tree gave identical counts (`plugins/sp/tests/hooks/context-hooks.test.ts` 59 bun/15 sh twice; `apps/cli/tests/commands/self/status.test.ts` 15 spur-cli twice) and the file set is the manifest's. Unit proof: `scripts/commands/test-lanes.test.ts`. |
| R2 | MET | Both named levers landed. CLI spawns → in-process `main()` on the measured top contributors: pr5 124→4 s, help-docs 82→0 s, pr6 53→1 s, show-branches 46→7 s, init 45→6 s, artifacts 25→4 s, pr7 20→0 s. Repeated per-test git fixture setup → per-file template on `apps/cli/tests/commands/builder/show-branches.test.ts:66` (one repo built once, copied per test; identity via `GIT_AUTHOR_*`/`GIT_COMMITTER_*`). Set sum 613 s → 170 s (−72 %). |
| R3 | MET | Test counts unchanged per touched file: pr5 35→35, pr6 32→32, pr7 15→15, init 72→72, artifacts 16→16, show-branches 34 (32 pass + 2 load-related base failures) → 34, help-docs 3→3, cli-surface 17→17. No timeout raised, no `test.skip` added, no `expect` removed — conversions change only the source of the same claim (`r.status`/`proc.exited` → `main()` code, captured stdout/stderr). |
| R4 | MET | `config/test-lanes.json` regenerated: 142 subprocess-lane files; `test-lanes --check` reports "matches the tree (142 file(s))". pr5/pr6/pr7 left the lane because they no longer spawn. |
| R5 | MET | `.spur/run/spawn-cost/after.json` (same driver, same host, final tree) plus the root pair: `bun run test` 788 s before (`before-root.json`) → 398 s after (`after-root.json`), both `0 fail`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a per-file spawn-cost receipt ranks the subprocess lane | MET | command | `.spur/run/spawn-cost/before.json`: one row per `root.subprocess` file with `wallMs`, `testCount`, `children{spur-cli,git,bun,sh,other}`; repeat-run counts identical (hooks 59 bun/15 sh ×2, status 15 spur-cli ×2); driver `scripts/commands/test-lanes.ts:305` |
| AC2 — the top contributors drop their avoidable children | MET | command | before.json top-12 (613 s) → 170 s on the same host = −72 % (−40 % required); test counts unchanged (R3 row); diff review: no skip, no raised timeout, no removed `expect` |
| AC3 — the lane manifest and root suite stay honest | PARTIAL | command | manifest: `test-lanes --check` passes on the regenerated 142-file manifest; wall: 788 s → 398 s (−49 %). **Exit code**: both runs exit 1 while reporting `0 fail` — the `a2a-remote-dialog.ts` per-file threshold (80 % functions) breaches at base too (`before-root.log:328`); not introduced or touched here (P4-2) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PARTIAL) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-27T20:23:41.792Z backlog → todo (system)
- 2026-11-28T01:30:02.641Z todo → wip (system)
- 2026-11-28T01:58:26.720Z wip → testing (system)
- 2026-11-28T01:59:02.316Z testing → done (system)

