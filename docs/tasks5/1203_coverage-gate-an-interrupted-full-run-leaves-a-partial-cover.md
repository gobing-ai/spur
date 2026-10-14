---
schema_version: 1
name: "coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files"
status: done
template: standard
created_at: 2026-10-14T03:25:27.063Z
updated_at: "2026-10-14T07:21:05.650Z"
feature_id: C3

ac_altitude: graduating
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1203-verdict.json
---

## 1203. coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files

### Background

The original session reported interrupted and stale .coverage/lcov.info producing low per-file results that disappeared after a full run. Those timestamps and counters are historical operator observations; the original run artifacts were not supplied for fresh verification. The current code establishes the actionable defect independently: run-tests.ts directly spawns Bun, the root test configuration enables LCOV, and coverage-gate.yaml reads .coverage/lcov.info without completion or tested-tree provenance. Both bare targeted runs and killed canonical runs can therefore supply uncertified data to the post-check.

**Refine corrections (2026-10-13)**
- Task 1204 is review confidence, not a hanging-test task. Remove the false dependency and all hang ownership references; hang diagnosis is out of scope.
- Interrupted counters are a hypothesis, not a proven causal trace; do not spend another full suite just to reproduce historical timing. Pin interrupted producer behavior with bounded child-process fixtures.
- File count, mtime and a success marker alone do not prove artifact identity or freshness. Bind a successful canonical run to both LCOV bytes and the working-tree fingerprint.
- Do not silently skip missing/stale evidence: repository post-check fails with a distinct provenance diagnostic before executing per-file rules.
- A successful canonical full run is required to publish proof. A failing completed run retains its real test/coverage failure and cannot certify the artifact.
- Existing root test-post-check and test-post-check:full compose the prerequisite; the portable ts-rule-engine evaluator remains unchanged.

### Requirements

- [x] R1. Canonical root test, test:coverage and test:full runs invalidate prior coverage certification before launching and certify only an exit-zero full-suite run whose tested working-tree fingerprint is unchanged from start to finish.
- [x] R2. test-post-check and test-post-check:full validate certification before rule evaluation; missing, pending, malformed, superseded, stale-tree, missing-LCOV or byte-mismatched evidence fails nonzero with a coverage-artifact diagnostic and no per-file coverage findings.
- [x] R3. Valid certified evidence still reaches the existing coverage-gate evaluator with its existing path, production include globs, diagnostic shape and 90 percent threshold; Bun's 90/90 line/function thresholds remain unchanged.
- [x] R4. Certification adds no second full-suite execution or source-count scan. Targeted, heavy, repo-wide and interrupted producers cannot certify canonical coverage or clobber its certified artifact; concurrent canonical producers fail closed or supersede deterministically.
- [x] R5. Regression fixtures cover producer interruption, nonzero exit, source changes during/after a run, targeted overwrite and concurrent publication. Producer and post-check documentation names the canonical certification route and recovery command.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Interrupted and targeted evidence cannot become file verdicts (req: R1, R2, R4)
  Given bounded producers that exit nonzero, are interrupted, or run only a targeted subset
  When coverage-artifact-check and the repository post-check evaluate their artifacts
  Then they fail with a provenance diagnostic before the coverage rule runs
Scenario: AC2 — Certified evidence retains real threshold failures (req: R2, R3)
  Given a certified fixture whose production file has 89 percent line coverage
  When provenance validation passes and the real existing coverage evaluator reads it
  Then the evaluator reports its original below-threshold finding
  And an otherwise identical 90 percent fixture passes
Scenario: AC3 — Tree and artifact identity are enforced (req: R1, R2, R5)
  Given a successful canonical fixture producer
  When source changes during or after its run, LCOV bytes change, or a marker is malformed or missing
  Then certification or post-check refuses the evidence
Scenario: AC4 — Concurrent publication is fail closed and bounded (req: R4, R5)
  Given two controlled canonical fixture producers with distinct run ids
  When the earlier producer finishes after a later producer starts
  Then the earlier producer cannot publish certification over the later run
  And each canonical command launches exactly one suite child
Scenario: AC5 — Recovery and caller scope are documented (req: R3, R5)
  Given root package.json and config/rules/quality/coverage-gate.yaml
  When the entrypoints and producer note are inspected
  Then both repository post-check variants validate provenance first
  And a completed successful canonical full run is the documented recovery
  And direct portable spur rule execution is documented as outside this repository certification wrapper
```

### Q&A

- Closed: invalid provenance is a distinct nonzero precondition failure, never a green skip. Genuine suite failures keep their own exit status.
- Closed: certify only canonical commands, with an internal --publish-coverage launcher flag consumed before forwarding Bun arguments. No public spur API is added.
- Closed: reuse computeProofInputFingerprint from @gobing-ai/spur-app for the tested tree, without task/feature inputs; its existing corpus exclusions avoid invalidating coverage for task receipts.
- Closed: marker contains an LCOV digest and tree digest; byte count, mtime and SF count are not identity checks.
- Closed: no dependency on the review-confidence task; historical hang repair is outside this task.

### Design

WHAT/WHERE: scripts/commands/run-tests.ts remains the producer. Add an internal --publish-coverage flag only to root test, test:coverage and test:full scripts; strip it from the forwarded argv. Put the shared certificate reads/writes and validation in scripts/commands/coverage-artifact-check.ts with import-safe exports and an import.meta.main command entrypoint. Wire that command before the current rule command in both test-post-check variants. This is repository command composition under ADR-130, not a rule-engine workaround or public CLI addition.

Certificate schema is frozen: schemaVersion: 1, state: pending|complete, runId, treeDigest and, when complete, lcovDigest. Store at .coverage/full-suite.json. Use existing computeProofInputFingerprint({cwd}) via the @gobing-ai/spur-app export for tree binding, and Bun.CryptoHasher('sha256') for LCOV bytes. Capture failures are named precondition errors, never sentinel digests. Fingerprints use existing corpus exclusions; source/tests/config/package/lock changes and nonignored additions invalidate proof.

Producer sequence: capture starting tree; atomically replace the certificate with pending plus a unique runId BEFORE spawning; force Bun output into a unique .coverage/run-<runId> directory using --coverage-dir. Preserve the launcher's environment isolation, forwarded test args and child exit status. On exit zero, require a nonempty LCOV artifact, an unchanged end fingerprint and current pending runId ownership; only then publish the LCOV atomically to .coverage/lcov.info followed by the complete certificate with its hash. Use a short exclusive publication section around ownership check and both renames, with finally cleanup; acquire only during publication so interruption of a test child does not strand a lock. Competing publication fails closed with a named diagnostic; an interrupted publisher cannot leave a certificate that validates mismatched bytes. Do not certify a partial/malformed LCOV file; validate at least complete records before publishing, without recreating threshold logic.

Noncanonical launcher runs send LCOV to their own disposable output directory and never publish full-suite.json or .coverage/lcov.info. Bare root bun test can still overwrite the legacy path; LCOV hash validation catches that. Successful canonical output cleanup occurs only after publication; failed/interrupted runs retain no complete certificate for their pending identity. A signal handler is not trusted as the certification mechanism: pending-before-spawn handles abrupt termination. Child nonzero exit remains nonzero; a certification failure after exit zero returns 1.

Consumer sequence: require schema/complete state/runId, regular nonempty LCOV, matching byte digest and current tree digest; error text starts coverage-artifact-check and gives the reason plus bun run test as recovery. Only success invokes existing source-local rule run. Keep coverage-gate.yaml's evaluator and threshold unchanged; update its producer note and recommended-post-check header to explain this repo entrypoint contract. Standalone portable rule run continues its existing raw-LCOV behavior; this task makes no new cross-project engine promise.

Tests: add scripts/commands/coverage-artifact-check.test.ts and run-tests.test.ts beside existing repository command tests. Use temporary Git repos and bounded child fixtures; check actual certificate/LCOV IO, not mocks of the producer under test. AC2 exercises the real rule engine with certified temporary fixtures. Integration must assert the failing prerequisite prevents rule invocation. Update existing command-contract fixtures only where entrypoint strings actually change.

C3 owns this outcome; graduating AC match its ship scenarios and task-local numbering binds every task requirement. No task dependencies. Before implementation, recheck the dirty F43 tree and obtain exclusive clean-tree ownership; no unrelated source changes are part of this task.

Out of scope: hangs, threshold lowering, per-file exemptions, new evaluator configuration, duplicating LCOV coverage math, an extra suite, or walking sources to estimate completeness.

### Plan

1. Recheck launcher/post-check callers, ownership and generated command-contract fixtures. Start from a clean task-owned tree; preserve unrelated F43 work (R1-R5).
2. Add small temporary-repo certificate tests and bounded producer fixtures: success, nonzero, interruption, targeted run, bad marker, tampering, source changes and concurrent producer order (R1/R2/R4/R5).
3. Implement certificate validation/publication in coverage-artifact-check.ts, reuse the existing fingerprint helper and preserve command import safety. Add --publish-coverage handling and isolated output directories in run-tests.ts (R1/R2/R4).
4. Compose the flag into the three canonical root scripts and provenance validation into both post-check variants; update rule headers and affected command-contract fixtures. Keep threshold/evaluator configuration unchanged (R2/R3/R5).
5. Prove with actual rule-engine fixtures that certified 89 percent still fails and 90 percent passes; prove invalid certification prevents rule invocation and late producers cannot certify newer output (R2-R5).
6. Run focused repository script tests and affected command-contract tests, then the task pipeline's canonical gate once. Inspect its certificate and run bun run test-post-check without another suite. C3 acceptance owns its feature-scoped pass; never add a redundant full run to this task (R1-R5).

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `config/rules/quality/coverage-gate.yaml:2` |
| `package.json:100` |
| `package.json:84` |
| `package.json:87` |
| `package.json:91` |
| `package.json:98` |
| `plugins/sp/lib/idea-handoff.generated.mjs:325` |
| `plugins/sp/lib/inline-run.generated.mjs:1385` |
| `plugins/sp/lib/inline-run.generated.mjs:1534` |
| `plugins/sp/lib/inline-run.generated.mjs:266` |
| `plugins/sp/lib/inline-run.generated.mjs:3044` |
| `plugins/sp/lib/quality-gate.generated.mjs:16710` |
| `plugins/sp/lib/quality-gate.generated.mjs:17017` |
| `plugins/sp/lib/quality-gate.generated.mjs:17040` |
| `plugins/sp/lib/quality-gate.generated.mjs:17134` |
| `plugins/sp/lib/quality-gate.generated.mjs:17168` |
| `plugins/sp/lib/quality-gate.generated.mjs:24731` |
| `plugins/sp/lib/quality-gate.generated.mjs:24859` |
| `plugins/sp/lib/quality-gate.generated.mjs:24862` |
| `plugins/sp/lib/quality-gate.generated.mjs:24865` |
| `plugins/sp/lib/quality-gate.generated.mjs:24884` |
| `plugins/sp/lib/quality-gate.generated.mjs:25149` |
| `plugins/sp/lib/quality-gate.generated.mjs:25191` |
| `plugins/sp/lib/quality-gate.generated.mjs:27297` |
| `plugins/sp/lib/quality-gate.generated.mjs:27401` |
| `plugins/sp/lib/quality-gate.generated.mjs:27404` |
| `plugins/sp/lib/quality-gate.generated.mjs:27521` |
| `plugins/sp/lib/quality-gate.generated.mjs:27620` |
| `plugins/sp/lib/quality-gate.generated.mjs:30` |
| `plugins/sp/lib/quality-gate.generated.mjs:41` |
| `plugins/sp/lib/quality-gate.generated.mjs:64` |
| `plugins/sp/lib/quality-gate.generated.mjs:67` |
| `plugins/sp/lib/quality-gate.generated.mjs:72` |
| `plugins/sp/lib/quality-gate.generated.mjs:75` |
| `scripts/commands/coverage-certification.test.ts:1` |
| `scripts/commands/coverage-certification.ts:1` |
| `scripts/commands/coverage-provenance-check.ts:1` |
| `scripts/commands/run-tests.ts:104` |
| `scripts/commands/run-tests.ts:24` |
| `scripts/commands/run-tests.ts:38` |
| `scripts/commands/run-tests.ts:80` |
| `scripts/commands/run-tests.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1. Canonical root test, test:coverage and test:full runs invalidate prior coverage certification before launching and certify only an exit-zero full-suite run whose tested working-tree fingerprint is unchanged from start to finish. | MET | scripts/commands/run-tests.ts: --publish-coverage consumed before forwarding; startCanonicalRun (invalidates + fingerprints tracked tree) runs BEFORE Bun.spawnSync; certifyCanonicalRun runs only on exitCode===0 and requires the finish digest to equal the start digest (coverage-certification.ts certifyCanonicalRun). Tests: 'a passing canonical run certifies the artifact…', 'a failing canonical run keeps its real exit code and leaves evidence pending', 'an interrupted canonical producer never certifies', 'a source change during the run refuses publish…stale-tree'. |
| R2. test-post-check and test-post-check:full validate certification before rule evaluation; missing, pending, malformed, superseded, stale-tree, missing-LCOV or byte-mismatched evidence fails nonzero with a coverage-artifact diagnostic and no per-file coverage findings. | MET | scripts/commands/coverage-provenance-check.ts exits nonzero with 'coverage-artifact: <reason>' + recovery before `&& spur rule run`; package.json prefixes both test-post-check scripts with it. validateCoverageCertification returns seven distinct reasons; each pinned by a dedicated test (missing/malformed json/malformed schema/pending/superseded/missing-lcov/stale-tree/lcov-mismatch) plus the precondition CLI diagnostic test. |
| R3. Valid certified evidence still reaches the existing coverage-gate evaluator with its existing path, production include globs, diagnostic shape and 90 percent threshold; Bun's 90/90 line/function thresholds remain unchanged. | MET | config/rules/quality/coverage-gate.yaml diff is comment-only (evaluator block untouched); bunfig.toml untouched. AC2 tests evaluate certified fixture lcov through the real builtin coverage-gate evaluator (RuleEngine host): 89% file keeps its below-threshold finding, 90% passes; lcovPath/threshold/include carried unchanged. |
| R4. Certification adds no second full-suite execution or source-count scan. Targeted, heavy, repo-wide and interrupted producers cannot certify canonical coverage or clobber its certified artifact; concurrent canonical producers fail closed or supersede deterministically. | MET | Producer test proves exactly one suite child per canonical command (PATH-counting shim, one log line). Wiring test pins test:heavy/test-repo-wide WITHOUT --publish-coverage. Interrupted run leaves pending (SIGKILL test); targeted overwrite fails validation with lcov-mismatch; concurrent runs: earlier publish refused with superseded, later certifies. |
| R5. Regression fixtures cover producer interruption, nonzero exit, source changes during/after a run, targeted overwrite and concurrent publication. Producer and post-check documentation names the canonical certification route and recovery command. | MET | scripts/commands/coverage-certification.test.ts: 17 tests covering all named scenarios against bounded git-repo child-process fixtures. Docs: run-tests.ts header names the canonical route + recovery; coverage-gate.yaml PROVENANCE block names producers, marker path, refusal reasons, recovery (bun run test:full) and the portable-rule boundary. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET |  | failing-run, interrupted (SIGKILL), and targeted-overwrite tests all leave/refuse with pending/lcov-mismatch before any rule evaluation; precondition CLI exits 1 with coverage-artifact diagnostic. |
| AC-2 | MET |  | 89% fixture keeps below-threshold finding and 90% passes through the real builtin evaluator with unchanged path/globs/threshold. |
| AC-3 | MET |  | stale-tree (content-hashed worktree bytes, index-independent), lcov-mismatch, malformed and missing-marker refusals all pinned. |
| AC-4 | MET |  | earlier producer publish refused as superseded once a later run starts; exactly one suite child per canonical command (shim count). |
| AC-5 | MET |  | wiring test pins --publish-coverage on test/test:coverage/test:full, its absence on heavy/repo-wide, and provenance-first prefixes on both post-checks; recovery documented in yaml + CLI stderr. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA review of the 1203 diff (scripts/commands/coverage-certification.ts, coverage-provenance-check.ts, run-tests.ts, package.json, coverage-gate.yaml):

- Security: marker at .coverage/coverage-certification.json (gitignored); atomic write via tmp+rename; malformed/absent evidence fails closed; refusal diagnostics name no secrets. Certification only from the launcher's own completed exit-zero run — a bare or targeted bun test cannot publish.
- Edge cases: interrupted producer leaves pending (SIGKILL-pinned); concurrent canonical producers supersede deterministically (later start wins, earlier publish refused); mid-run worktree edits caught by content-hashed tracked-tree digest (index-independent); deleted tracked files hash as '<missing>'; refusal path cleans the registry temp dir.
- Correctness: lcov digest + tree digest both bound at publish; validation re-checks bytes and tree. Evaluator/threshold untouched (yaml comment-only). One suite child per canonical command (shim-counted).
- Usability: post-check refusal prints `coverage-artifact: <reason>` plus recovery (`bun run test:full`); producer/provenance headers and the rule file document the canonical route and the portable-rule boundary.
- Architecture: certification is dependency-free (node builtins + git), self-contained in scripts/commands because scripts/ cannot resolve workspace app packages; no evaluator or CLI changes.

| Priority | Finding | Status |
| -------- | ------- | ------ |
| P3 | Refusal path in run-tests.ts left the disposable registry temp dir behind | Fixed inline (rmSync before exit) |
| P3 | Fixture tests with no imported source file emit no tracefile (empty measured set) | Fixed inline (fixtures import case/tiny.ts) |
| P4 | Committed plugins/sp/lib/*.generated.mjs embed ts-db 0.5.26 vs installed 0.5.27 (pre-existing base failure, unrelated to 1203) | Regenerated in a separate chore commit |

### References

- Feature C3: docs/features/C3_coverage-artifact-provenance-and-completion-integrity.md
- scripts/commands/run-tests.ts: current Bun.spawnSync producer and environment isolation.
- package.json: test, test:coverage, test:full, test-post-check, test-post-check:full, test:heavy and test-repo-wide callers.
- bunfig.toml: LCOV location and per-file 90/90 thresholds; bunfig.heavy.toml: separate heavy test configuration.
- config/rules/quality/coverage-gate.yaml and config/rules/recommended-post-check.yaml: current unbound LCOV consumption.
- packages/app/src/workflow/proof-input-fingerprint.ts: computeProofInputFingerprint and isolated alternate-index tree capture.
- scripts/commands/command-contract.test.ts: existing entrypoint contract coverage.
- Snapshot: 2026-10-13 local refinement, HEAD 46718be2c. Historical interrupted-run logs are unavailable; no timing-based root-cause claim is made.

### History

- 2026-10-14T05:47:33.896Z backlog → todo (system)
- 2026-10-14T06:52:43.585Z todo → wip (system)
- 2026-10-14T07:21:05.642Z wip → done (system)

