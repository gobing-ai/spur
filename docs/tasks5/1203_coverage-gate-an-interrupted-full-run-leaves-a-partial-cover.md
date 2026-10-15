---
schema_version: 1
name: "coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files"
status: done
template: standard
created_at: 2026-10-14T03:25:27.063Z
updated_at: "2026-10-15T00:39:11.267Z"
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

#### Q&A entry — 2026-10-15T00:18:02.902Z

#### Shippable follow-up — 2026-10-15

The operator requested remaining tasks 1203/1204/1207 be completed and verified before a later commit. No commit was made.

Fresh `bun run spur-check-feature` passed all structural checks, 10 repository-wide tests and 28 heavy tests (0 failures); log: `.spur/run/shippable-feature-gate.log`. Derived confidence completion-boundary tests passed 8/8 in `.spur/run/shippable-derived-recheck.log`. The command-gate hard-failure test passed alone in 14 ms after a full-suite timeout; this does not erase the failed full-suite evidence.

The normal full gate ran with concurrent external gate activity and reported unrelated timing/subprocess failures. Its original process ended without a complete final receipt; `.spur/run/shippable-spur-check.log` remains a failed/incomplete attempt. A diagnostic two-worker run and a fresh canonical two-worker run were started without changing repository scripts, timeouts, threshold or file isolation. Their final outcomes must be collected before claiming a new task PASS.

Concurrent writes were observed in `packages/domain/tests/analytics/forensic-query-history.test.ts`: the existing 100 ms assertion was commented out by another writer during the first gate. This change was preserved and was not made as part of this task. The original assertion failed at 103 ms under load, and at 197 ms in a focused run while the host was still contended. A green run over the changed tree cannot be represented as proof that the original timing contract passed.

Task 1204's original confidence requirements conflict with the explicitly authorized retirement in 1207/ADR-138. The original contract and fresh FAIL record remain intact pending the operator's explicit choice of historical disposition; no acceptance criterion is weakened to manufacture PASS.

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

The original canonical coverage wrapper was delivered in commits 8e67f8ea0 and 92b8043a6. Forced verification on 2026-10-14 reproduced three gaps with failing tests: old LCOV could satisfy a run that emitted none, newly added source was absent from the fingerprint, and noncanonical launcher output overwrote certified LCOV. Inspection also found publication ownership spanning an await.

Verification fix:
- `scripts/commands/coverage-certification.ts:108` — one short exclusive publication lock protects pending-window replacement and the final ownership check plus LCOV/certificate publication.
- `scripts/commands/coverage-certification.ts:120` — reuse the existing computeProofInputFingerprint implementation, including nonignored new sources and its corpus exclusions; no duplicated fingerprint engine or source-count scan. Repository command import follows existing 0775 command precedent because spur-app has no root workspace link.
- `scripts/commands/coverage-certification.ts:130` — unique coverage directory per canonical run; certification at `scripts/commands/coverage-certification.ts:166` reads only that run's complete LCOV records, then atomically publishes while still owning the pending window.
- `scripts/commands/coverage-certification.ts:230` — retain named provenance refusals, validate optional marker fields, and surface failed tree capture as tree-unavailable before rule evaluation.
- `scripts/commands/run-tests.ts:96` — canonical children write run-owned output; noncanonical children write disposable output. Bun's configured coverageDir overrides its CLI flag, so copy the selected TOML config, change only its output directory and resolve existing preload paths. Thresholds, ignore patterns, explicit heavy config and child exit status remain intact. One suite child is launched at `scripts/commands/run-tests.ts:121`.
- `scripts/commands/coverage-certification.test.ts:126` — regressions cover the reproduced failures, shared lock contention, malformed run output, configuration preservation, interruption/nonzero exits, before/after source changes, 89/90 real evaluator behavior and command wiring.
- `config/rules/quality/coverage-gate.yaml:3` — producer/provenance comments now describe isolated launcher output and bare Bun's legacy overwrite boundary; evaluator path, globs, diagnostic and threshold unchanged.

Design conformance: isolation, ownership locking, complete-record validation and the shared proof-input implementation now match the approved mechanism. Goal-equivalent compatibility choice: retain the shipped .coverage/coverage-certification.json path and pending/certified field names rather than migrate to the draft full-suite.json naming. All existing consumers keep the same artifact path and root scripts; no new public CLI surface or external dependency.

The final bounded script suite passed 25 tests, including the corrected preload fixture and explicit missing-config refusal; script typecheck and scoped formatting passed. The full gate failed on a 60-second derived-HIGH test timeout and its matrix follow-on, so Testing records PARTIAL. The final missing-config guard has focused/typecheck evidence and no green full-gate claim. Prior red attempts remain in .spur/run/verifyall-1203-red.log and .spur/run/verifyall-spur-check.log; no failed receipt is counted as successful. This fix does not include the existing unrelated DatabaseView.tsx edit.

#### Final shippable validation — 2026-10-15

This supersedes the earlier PARTIAL validation state, while retaining all red/interrupted run logs. The exact root `bun run spur-check` exited 0: lint/typechecks, all 51 pre-check rules, 10748 tests across 614 files (0 failures), unchanged-tree certified coverage, and both post-check rules. Evidence: `.spur/run/shippable-bounded-final-gate.log`.

`package.json:87` bounds the root suite at two isolated parallel workers. The previous CPU-count fan-out repeatedly timed out different subprocess-heavy cases on the shared host; the bounded default completed the entire suite in 258.50 seconds. Test selection, isolation, the existing 20-second timeout and per-file 90/90 coverage thresholds are unchanged. The analytics timing assertion disabled by another writer during an intermediate run was restored before final validation and passed in the final suite. No production process-execution workaround, dependency change, assertion removal or timeout increase was introduced. Temporary tracing was removed.

Task 1204 is retained as deprecated under the existing 1207/ADR-138 retirement decision, tagged `superseded:1207`. Its original requirements, historical delivery receipts and current-tree FAIL re-audit are preserved; current confidence-free behavior is verified by 1207. F51 remains cancelled. No commit was made.

Final feature-wide validation also passed on the bounded-worker tree: `bun run spur-check-feature` exited 0; all structural checks, 10 repository-wide tests and 28 heavy tests passed. Log: `.spur/run/shippable-bounded-feature-gate.log`. Post-record C3/F511 feature checks have zero findings and all linked tasks are done; current delivery aggregate is PASS. The original three-task aggregate remains FAIL solely because it retains 1204's current-tree historical FAIL; that task is now deprecated under the authorized retirement, not falsely relabeled PASS. Coverage certification still validates after the noncanonical feature-wide run. No commit was made.

Validated root launcher configuration: `package.json:87`; coverage producer ownership: `scripts/commands/coverage-certification.ts:130`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/coverage-certification.ts:130` opens a pending window before the child; `scripts/commands/coverage-certification.ts:166` certifies only owned complete output. Final 25-test coverage suite passed, including explicit-config validation and preservation. |
| R2 | MET | `scripts/commands/coverage-certification.ts:230` validates provenance; `scripts/commands/coverage-certification.test.ts:409` proves failed tree capture is a named refusal. Fresh 25-test suite covered missing, malformed, pending, superseded, stale and byte-mismatched evidence; post-check CLI diagnostic test passed. |
| R3 | MET | `scripts/commands/coverage-certification.test.ts:439` and `scripts/commands/coverage-certification.test.ts:455` certify fixtures before the real coverage evaluator: 89 percent fails and 90 percent passes. Root threshold and production globs are unchanged. |
| R4 | MET | `scripts/commands/coverage-certification.test.ts:145` proves a noncanonical launcher preserves certified bytes; `scripts/commands/coverage-certification.test.ts:166` proves exclusive publication and pending-window replacement; `scripts/commands/coverage-certification.test.ts:293` proves supersession. Exactly-one-child fixture passed. |
| R5 | MET | `scripts/commands/coverage-certification.test.ts:126`, `scripts/commands/coverage-certification.test.ts:135`, `scripts/commands/coverage-certification.test.ts:262`, `scripts/commands/coverage-certification.test.ts:276` and `scripts/commands/coverage-certification.test.ts:467` cover stale output, added source, interruption, source drift and producer/recovery wiring; fresh focused suite passed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Interrupted and targeted evidence cannot become file verdicts | MET | test | `scripts/commands/coverage-certification.test.ts:254` and `scripts/commands/coverage-certification.test.ts:262` cover failed/interrupted producers; `scripts/commands/coverage-certification.test.ts:145` proves noncanonical isolation; 25 focused tests passed. |
| Certified evidence retains real threshold failures | MET | test | `scripts/commands/coverage-certification.test.ts:439` and `scripts/commands/coverage-certification.test.ts:455` passed certified-fixture checks and the real 89/90 evaluator behavior. |
| Tree and artifact identity are enforced | MET | test | `scripts/commands/coverage-certification.test.ts:126`, `scripts/commands/coverage-certification.test.ts:135` and `scripts/commands/coverage-certification.test.ts:276` passed stale output, added-source and during-run drift regressions; marker/tamper/after-run cases passed in the same suite. |
| Concurrent publication is fail closed and bounded | MET | test | `scripts/commands/coverage-certification.test.ts:166` passed shared-lock exclusion and late-owner checks; `scripts/commands/coverage-certification.test.ts:293` passed supersession; exactly-one-child test passed. |
| Recovery and caller scope are documented | MET | test | `scripts/commands/coverage-certification.test.ts:467` passed canonical and post-check wiring; provenance CLI recovery test passed; `config/rules/quality/coverage-gate.yaml:3` records the direct-rule boundary. |
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

#### Source verification of API/library claims (post-merge audit)

| Claim | Source | Confidence |
| ----- | ------ | ---------- |
| bunfig `[test] coverage`/`coverageReporter=["lcov"]` writes lcov.info to coverageDir | bun.sh/docs/test/coverage | HIGH (doc + empirical) |
| No tracefile when measured set is empty (test files excluded by default; only loaded files tracked) | bun.sh/docs/test/coverage | HIGH |
| `git ls-files -s` sees the index, not worktree bytes → content hashing required | git-scm.com/docs/git-ls-files | HIGH |
| `git ls-files -z` = NUL-terminated unquoted paths | git-scm.com/docs/git-ls-files | HIGH |
| Bun.spawnSync env/pipe/exitCode; spawn+kill/exited for interruption fixture | bun.sh/docs/api/spawn | HIGH |
| process.execPath bypasses PATH shim (shim count = 1 proves it) | in-test empirical | HIGH |
| ts-rule-engine 0.5.27: RuleEngine ctor registers builtins; 'coverage-gate' evaluator; {findings,fixes}; SF/LF/LH parsing | node_modules dist (version-pinned): engine.js:19, builtins.js, types.d.ts:133, coverage-gate-evaluator.js | HIGH |
| scripts/ cannot resolve @gobing-ai/spur-app | runtime + node_modules inspection | HIGH |
| per-file coverage threshold semantics | bunfig.toml:13 repo-verified note; docs agree on exit behavior | MEDIUM (granularity is repo-empirical) |

No claim rested on memory alone; all HIGH items are doc-cited and test-backed.

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

