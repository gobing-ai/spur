---
schema_version: 1
name: Cut per-test child-process cost in the subprocess-lane root test files
status: todo
template: standard
created_at: 2026-11-27T19:06:07.059Z
updated_at: "2026-11-27T20:23:41.792Z"

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 8
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

- [ ] R1. A before-receipt at `.spur/run/spawn-cost/before.json` records, for every `root.subprocess` file in `config/test-lanes.json`: wall ms (file run alone), test count, and child-process count by kind (`spur-cli`, `git`, `bun`, `sh`, other), produced by a repeatable command checked into the task's Testing section.
- [ ] R2. The top contributors from R1 — files in descending wall-ms order until ≥50% of the summed subprocess-lane wall time is covered — have their avoidable children removed: CLI spawns replaced by in-process `main()` where the test asserts no process-level behaviour, and repeated per-test git fixture setup replaced by a per-file template repo copied per test.
- [ ] R3. No assertion is weakened, no timeout raised, no test skipped or moved out of the root suite; each touched file's test count is unchanged.
- [ ] R4. `config/test-lanes.json` is regenerated (`test-lanes` without `--check`) and `--check` passes.
- [ ] R5. An after-receipt (same command, same host) at `.spur/run/spawn-cost/after.json`, plus a before/after root `bun run test` wall-time pair, are cited in Testing.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-27T20:23:41.792Z backlog → todo (system)

