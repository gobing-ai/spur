---
schema_version: 1
name: Isolate the parallel suite's shared resources (live git tree, project DB) so a contended host cannot fail it
status: backlog
template: standard
created_at: 2026-10-13T21:14:35.289Z
updated_at: "2026-10-13T21:14:37.482Z"

priority: P1
estimate_hours: 6
---

## 1199. Isolate the parallel suite's shared resources (live git tree, project DB) so a contended host cannot fail it

### Background

The parallel suite is not isolated from itself. Two shared resources make the whole-suite verdict depend on host load rather than on the code:

1. **The live checkout as the test subject.** `proof-input-fingerprint.test.ts` and `proof-fingerprint.test.ts` hashed the real repo (`process.cwd()`, ~3.5k tracked files). Measured 2026-10-13: one `git add -A` capture costs 150-350ms idle and blew a 5s (and once a 30s) budget whenever sibling suites were running; the probe file the second test wrote (`docs/design/zz-proof-fingerprint-probe.md`) landed **in the real repo** and survived a kill. `proof-input-fingerprint` / `proof-fingerprint` are already fixed by hashing a `mkdtemp` fixture repo — the remaining files below are the same class.
2. **Real git and real DB work in the shared tree.** `corpus-migrator.test.ts` (0.94s idle, >5s loaded), `anchor-qualifier.test.ts > resolveRepoRoot` (needs cwd to be a repo), `inline-run-setup.test.ts` / `command-gate.test.ts` (7s per file idle, >60s loaded) spawn git/bun children and open SQLite. A probe run during a suite hit a live `.git/index.lock` in the repo — parallel test files do real index operations on the one repo they share.

Evidence (2026-10-13, host = 10 cores): a single full-suite run while ~20 spinners oversubscribed the host produced 7 failures across 4 files (`proof-input-fingerprint`, `proof-fingerprint`, `corpus-migrator`, `anchor-qualifier`, plus `command-gate`/`agent-run` timeouts in a second run); each test passed 3/3 in isolation in 0.15s-1s. Three concurrent suites on an idle host reproduced the same class (different test each run). The per-test budget was raised 20s -> 60s (`package.json` `test` script), which is mitigation, not isolation — under extreme contention even 60s is not enough (`CommandGateActionRunner > softFail` 60.0s, `CorpusMigrator` 2 x 60s).

The pipeline needs the suite to be trustworthy on a *busy* host: sibling agents run gates in other worktrees, so "wait until the host is quiet" is not a durable contract.

### Requirements

- [ ] R1. No test hashes or mutates the live checkout: every test that needs a git tree builds one under `mkdtemp` and passes it explicitly (`cwd`), including `proof-input-fingerprint`, `proof-fingerprint` (done, keep) and `anchor-qualifier`'s `resolveRepoRoot` case.
- [ ] R2. Tests that open the project DB use an isolated database (temp file or `:memory:`) or a temp project root, so parallel test files cannot contend on one SQLite file; tests that only need a migrated DB must not touch `.spur/spur.db`.
- [ ] R3. A test killed by its timeout leaves nothing behind in the repo: no probe files, no stray `.git/index.lock`, no temp corpus. Cleanup is registered in `afterEach`/`try-finally` and the probe paths live under `tmpdir()`.
- [ ] R4. `scripts/commands/run-tests.ts` prints the host context (load1 vs cores) once per run, so a timeout-shaped failure is readable as contention rather than as a regression.

### Acceptance Criteria

- [ ] AC1 — The proof/anchor digest tests pass while the host is oversubscribed 10x (req: R1)
- [ ] AC2 — Two concurrent full-suite runs in the same tree report the same verdict (req: R2)
- [ ] AC3 — A killed digest/migrator test leaves `git status --porcelain` clean (req: R3)
- [ ] AC4 — The suite header names load1/cores when load1 exceeds cores (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHERE.** `packages/app/tests/workflow/proof-input-fingerprint.test.ts` (done — keep as the pattern), `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` (done), `packages/app/tests/services/anchor-qualifier.test.ts`, `packages/app/tests/services/corpus-migrator.test.ts`, `packages/app/tests/services/inline-run-setup.test.ts`, `packages/app/tests/workflow/actions/command-gate.test.ts`, `scripts/commands/run-tests.ts`.

**HOW.** (1) Follow the fixture-repo pattern already in `proof-fingerprint.test.ts`: `mkdtemp(join(tmpdir(), ...))` + `git init`/commit in `beforeAll`, `ctx.workdir = fixture`, `rm` in `afterAll`. (2) For `resolveRepoRoot`, build the fixture repo and call the helper with an explicit `projectRoot`; where the test must prove cwd derivation, run the probe in a subshell process (`bun -e`) rather than `process.chdir` (a process-global that breaks parallel test files). (3) For DB-touching tests, prefer the existing in-memory/temp-DB helper over the project DB; a shared `.spur/spur.db` is the contended resource. (4) `run-tests.ts` already owns the environment contract — add one advisory line there when `os.loadavg()[0] > os.availableParallelism()`.

**Anti-patterns.** Do not raise the timeout further as the primary fix (mitigation only, measured). Do not `process.chdir` in a test file. Do not weaken an assertion to make a loaded run green. Do not re-introduce a host-wide gate lock without an ADR (task 1173 removed it deliberately).

**Test requirement.** This is a test-infrastructure change: prove it by running the affected files under a deliberately loaded host (background spinners) and at idle, and record both numbers in the task's `## Testing`.

### Plan

1. `anchor-qualifier.test.ts`: fixture repo + explicit `projectRoot`; keep the cwd-derivation claim covered by a child-process probe.
2. `corpus-migrator.test.ts` / `inline-run-setup.test.ts` / `command-gate.test.ts`: find the shared-DB and real-git dependency per test, replace with temp root/DB; add `try-finally` cleanup (R3).
3. `run-tests.ts`: one advisory header line with load1/cores (R4). Keep the verbatim-forwarding contract: the line is informational, never an arg injection.
4. Verify: for each touched file, idle run + a run with background spinners; then two concurrent full-suite runs in one tree (AC2) and a `git status` check after a killed test (AC3).
5. Full gate once on a quiet host, then record the before/after numbers in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
