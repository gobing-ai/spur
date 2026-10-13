---
schema_version: 1
name: Isolate the parallel suite's shared resources (live git tree, project DB) so a contended host cannot fail it
status: todo
template: standard
created_at: 2026-10-13T21:14:35.289Z
updated_at: "2026-10-13T21:45:54.974Z"

priority: P1
estimate_hours: 2
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

- [ ] R1. No test reads or mutates the live checkout: every test that needs a git tree builds one under `mkdtemp` and passes it explicitly, including every `anchor-qualifier.test.ts` case that now uses `process.cwd()`, and no test calls `process.chdir`.
- [ ] R4. `scripts/commands/run-tests.ts` prints the host context (load1 vs cores) once per run when load1 exceeds cores, so a timeout-shaped failure reads as contention rather than as a regression.

### Acceptance Criteria

- [ ] AC1 — The anchor-qualifier tests pass from a cwd outside the repo and while the host is oversubscribed (req: R1)
- [ ] AC4 — The suite header names load1/cores when load1 exceeds cores (req: R4)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T21:44:29.239Z backlog → todo (system)

