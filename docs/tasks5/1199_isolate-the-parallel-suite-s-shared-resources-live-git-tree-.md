---
schema_version: 1
name: Isolate the parallel suite's shared resources (live git tree, project DB) so a contended host cannot fail it
status: done
template: standard
created_at: 2026-10-13T21:14:35.289Z
updated_at: "2026-10-14T04:37:15.728Z"

priority: P1
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1199-verdict.json
---

## 1199. Isolate the parallel suite's shared resources (live git tree, project DB) so a contended host cannot fail it

### Background

The parallel suite is not isolated from itself. Two shared resources make the whole-suite verdict depend on host load rather than on the code:

1. **The live checkout as the test subject.** `proof-input-fingerprint.test.ts` and `proof-fingerprint.test.ts` hashed the real repo (`process.cwd()`, ~3.5k tracked files). Measured 2026-10-13: one `git add -A` capture costs 150-350ms idle and blew a 5s (and once a 30s) budget whenever sibling suites were running; the probe file the second test wrote (`docs/design/zz-proof-fingerprint-probe.md`) landed **in the real repo** and survived a kill. `proof-input-fingerprint` / `proof-fingerprint` are already fixed by hashing a `mkdtemp` fixture repo — the remaining files below are the same class.
2. **Real git and real DB work in the shared tree.** `corpus-migrator.test.ts` (0.94s idle, >5s loaded), `anchor-qualifier.test.ts > resolveRepoRoot` (needs cwd to be a repo), `inline-run-setup.test.ts` / `command-gate.test.ts` (7s per file idle, >60s loaded) spawn git/bun children and open SQLite. A probe run during a suite hit a live `.git/index.lock` in the repo — parallel test files do real index operations on the one repo they share.

Evidence (2026-10-13, host = 10 cores): a single full-suite run while ~20 spinners oversubscribed the host produced 7 failures across 4 files (`proof-input-fingerprint`, `proof-fingerprint`, `corpus-migrator`, `anchor-qualifier`, plus `command-gate`/`agent-run` timeouts in a second run); each test passed 3/3 in isolation in 0.15s-1s. Three concurrent suites on an idle host reproduced the same class (different test each run). The per-test budget was raised 20s -> 60s (`package.json` `test` script), which is mitigation, not isolation — under extreme contention even 60s is not enough (`CommandGateActionRunner > softFail` 60.0s, `CorpusMigrator` 2 x 60s).

The pipeline needs the suite to be trustworthy on a *busy* host: sibling agents run gates in other worktrees, so "wait until the host is quiet" is not a durable contract.

**Refine corrections (2026-10-13)** — ready audit against HEAD `4a3649ae1`; issues triaged one by one:

- **Live checkout (R1) — valid.** `anchor-qualifier.test.ts` still reads the real repo: `resolveRepoRoot` with no `projectRoot` (`:90-103`), `buildTrackedBasenameIndex(process.cwd())` (`:124`), `createNodeFileSystem(process.cwd())` (`:142`) and `projectRoot: process.cwd()` (`:206`, `:243`, `:419`, `:438`). The R4 case also calls `process.chdir` (`:112`), which is this task's own anti-pattern.
- **Shared project DB (R2) — invalid, dropped with AC2.** No target test opens `.spur/spur.db` of the repo. `corpus-migrator.test.ts` works in `mkdtemp` corpora (`:25-27`), and its `git log` lookup runs in that temp dir. `inline-run-setup.test.ts` uses a temp DB (`:219`). Every other `spur.db` open in `plugins/sp/tests` is under a per-test fixture `workdir`. Their slowness under load is subprocess and CPU cost, not a shared resource.
- **Leftovers after a kill (R3) — already fixed, dropped with AC3.** The probe file was the only repo write, and `4dab6bcc0` moved it into a fixture repo. The remaining targets write only under `tmpdir()`. The `command-gate.test.ts` cases with `workdir: process.cwd()` (`:30`, `:95`, `:109`, `:119`, `:129`, `:213`) mock the executor and never spawn.
- **Host context header (R4) — valid.** `scripts/commands/run-tests.ts` has no `loadavg` or `availableParallelism` call.
- **Scope cut.** `corpus-migrator`, `inline-run-setup` and `command-gate` leave WHERE because they hold no shared resource. Their load timeouts belong to the load-flake budget contract (`cross-cutting.md` § Isolation rerun for load-flakes).
- **Concurrent work (uncommitted at audit time).** Another session is adding 60s per-test `loadFlakeTest` budgets to `anchor-qualifier`, `corpus-migrator`, `agent-run`, `command-gate` and `daily-summary` tests. It is also moving the `package.json` `test` budget from 60000 back to 20000. Rebase on that work before you edit `anchor-qualifier.test.ts`, and keep its budget wrapper.

- **Re-estimate.** `estimate_hours` drops from 6 to 2: one test file plus one advisory line. The title still names "project DB", which R2 dropped; the CLI cannot rename a task, so read the title as "live git tree" only.

### Requirements

- [x] R1. No test reads or mutates the live checkout: every test that needs a git tree builds one under `mkdtemp` and passes it explicitly, including every `anchor-qualifier.test.ts` case that now uses `process.cwd()`, and no test calls `process.chdir`.
- [x] R4. `scripts/commands/run-tests.ts` prints the host context (load1 vs cores) once per run when load1 exceeds cores, so a timeout-shaped failure reads as contention rather than as a regression.

### Acceptance Criteria

- [x] AC1 — The anchor-qualifier tests pass from a cwd outside the repo and while the host is oversubscribed (req: R1)
- [x] AC4 — The suite header names load1/cores when load1 exceeds cores (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHERE.** `packages/app/tests/services/anchor-qualifier.test.ts` and `scripts/commands/run-tests.ts`. The fixture pattern to copy is `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` (from `4dab6bcc0`).

**HOW.**
1. Build one fixture repo in `beforeAll`: `mkdtemp(join(tmpdir(), 'spur-anchor-'))`, `git init -q`, write a few tracked files (one under `.spur/`, so the `.spur/` filter case still proves something), then `git add` and `git commit`. Remove it in `afterAll`.
2. Point `buildTrackedBasenameIndex`, `createNodeFileSystem` and every `projectRoot` at the fixture.
3. Two cases prove derivation from the process cwd: "resolves git repo root when projectRoot is omitted" (`:90`) and the R4 hint case (`:105-118`). Run each in a child process: `Bun.spawnSync(['bun', '-e', <probe>], { cwd })`, where the probe imports `resolveRepoRoot` and prints the result. Assert on stdout. This replaces `process.chdir`, which is process-global and unsafe across parallel test files.
4. `run-tests.ts`: compute `const [load1] = os.loadavg(); const cores = os.availableParallelism();`. When `load1 > cores`, write one line to stderr, `run-tests: host load1=<x.x> cores=<n> — timeouts may be contention`, before it spawns bun. The line is advisory. It never changes the forwarded argv or the exit code.

**Anti-patterns.** Do not raise a timeout as the fix. Do not `process.chdir` in a test file. Do not weaken an assertion to get a loaded run green. Do not re-introduce a host-wide gate lock without an ADR; task 1173 removed it on purpose.

**Test requirement.** Run `anchor-qualifier.test.ts` from `$TMPDIR` as cwd, and once with background spinners (`yes > /dev/null` × 2×cores). Then run `run-tests.ts` under the same load and confirm the header line appears. Record both in `## Testing`.

### Plan

1. Rebase on the concurrent `loadFlakeTest` edit to `anchor-qualifier.test.ts` if it has landed.
2. `anchor-qualifier.test.ts`: add the fixture repo, point every live-tree reference at it, and move the two cwd-derivation cases into `bun -e` child probes (R1).
3. `run-tests.ts`: add the advisory load1/cores line (R4).
4. Verify: run `(cd packages/app && bun test tests/services/anchor-qualifier.test.ts)` idle and under spinners. Run the same file with `$TMPDIR` as cwd, using an absolute path. Run `bun run test` under load to see the header.
5. Run `bun run spur-check` once on a quiet host.

### Solution

1199 — point the anchor-qualifier tests at a `mkdtemp` fixture repo, and print the host load before the suite runs.

**R1 — no test reads or mutates the live checkout** (`packages/app/tests/services/anchor-qualifier.test.ts`):

| file:line | change |
| --- | --- |
| packages/app/tests/services/anchor-qualifier.test.ts:31 | `beforeAll` builds a `mkdtemp` fixture git repo (nested tracked files plus one under `.spur/`); `afterAll` removes it — the fixture pattern copied from `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:31` |
| packages/app/tests/services/anchor-qualifier.test.ts:64 | `probeRepoRoot` runs `resolveRepoRoot` in a child `bun -e` and returns its stdout — the cwd-derivation probe that replaces `process.chdir` |
| packages/app/tests/services/anchor-qualifier.test.ts:153 | "resolves git repo root when projectRoot is omitted" now probes from a child whose cwd IS the fixture (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:158 | "R4: hint resolves the target project root…" now runs two child probes (no-hint proves cwd alone misses the fixture; the hint resolves it) — `process.chdir` removed |
| packages/app/tests/services/anchor-qualifier.test.ts:175 | `buildTrackedBasenameIndex(fixtureRepo)` (was `process.cwd()`); the test asserts the fixture tracks `.spur/tracked.txt`, so the `.spur/` filter is proven rather than vacuous |
| packages/app/tests/services/anchor-qualifier.test.ts:196 | `createNodeFileSystem(fixtureRepo)` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:260 | `qualifyAnchors` dry-run `projectRoot: fixtureRepo` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:273 | `anchorQualify` apply gained `projectRoot: fixtureRepo` (previously omitted, so it resolved the live cwd) |
| packages/app/tests/services/anchor-qualifier.test.ts:298 | unreadable-files case `projectRoot: fixtureRepo` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:474 | `done_reason` dry-run `projectRoot: fixtureRepo` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:493 | `done_reason` apply `projectRoot: fixtureRepo` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:515 | already-relative reason `projectRoot: fixtureRepo` (was `process.cwd()`) |
| packages/app/tests/services/anchor-qualifier.test.ts:531 | unwritable-task `projectRoot: fixtureRepo` (was `process.cwd()`) |

**R4 — advisory host-context line** (`scripts/commands/run-tests.ts`):

| file:line | change |
| --- | --- |
| scripts/commands/run-tests.ts:26 | import `availableParallelism, loadavg` from `node:os` |
| scripts/commands/run-tests.ts:60 | read `load1`/`cores` and, when `load1 > cores`, write `run-tests: host load1=<x> cores=<n> — timeouts may be contention` to stderr once per run, before bun is spawned |
| scripts/commands/run-tests.ts:63 | the line is advisory only — the forwarded argv and the child's exit code are untouched |

The sibling `process.cwd()` receipt-capture defect in `packages/app/src/services/feature-check.ts:589` (which fails `packages/app/tests/services/feature-transition.test.ts:299`) is out of scope for 1199 and was left untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Within the Design WHERE (`anchor-qualifier.test.ts`): `mkdtemp` fixture repo in `packages/app/tests/services/anchor-qualifier.test.ts:31`; cwd-derivation probed in a child `bun -e` at `packages/app/tests/services/anchor-qualifier.test.ts:64` (used at `:153`, `:158`); `buildTrackedBasenameIndex(fixtureRepo)` at `:175`, `createNodeFileSystem(fixtureRepo)` at `:196`, `projectRoot: fixtureRepo` at `:273`. `grep` this run: no `process.cwd()` call and no `process.chdir` call left in the file (only doc comments). |
| R4 | MET | `scripts/commands/run-tests.ts:26` imports `availableParallelism, loadavg`; advisory line at `scripts/commands/run-tests.ts:60-63`, written before bun is spawned, argv and exit code untouched. Observed this run under load: `run-tests: host load1=18.90 cores=10 — timeouts may be contention`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The anchor-qualifier tests pass from a cwd outside the repo and while the host is oversubscribed (req: R1) | MET | command | From `$TMPDIR` as cwd with absolute test path: 36 pass / 0 fail; with 20 `yes` spinners on 10 cores (load1 18.9): 36 pass / 0 fail, 2.45s |
| AC4 — The suite header names load1/cores when load1 exceeds cores (req: R4) | MET | command | `bun scripts/commands/run-tests.ts packages/app/tests/services/anchor-qualifier.test.ts` under the same load printed the header line (see R4) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T21:44:29.239Z backlog → todo (system)
- 2026-10-14T02:18:24.220Z todo → wip (system)
- 2026-10-14T04:37:14.983Z wip → testing (system)
- 2026-10-14T04:37:15.610Z testing → done (system)

