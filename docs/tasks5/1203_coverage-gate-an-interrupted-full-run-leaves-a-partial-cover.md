---
schema_version: 1
name: "coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files"
status: todo
template: standard
created_at: 2026-10-14T03:25:27.063Z
updated_at: "2026-10-14T05:48:19.009Z"
feature_id: C3

ac_altitude: graduating
ac_numbering: task-local
priority: P2
estimate_hours: 8
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

- [ ] R1. Canonical root test, test:coverage and test:full runs invalidate prior coverage certification before launching and certify only an exit-zero full-suite run whose tested working-tree fingerprint is unchanged from start to finish.
- [ ] R2. test-post-check and test-post-check:full validate certification before rule evaluation; missing, pending, malformed, superseded, stale-tree, missing-LCOV or byte-mismatched evidence fails nonzero with a coverage-artifact diagnostic and no per-file coverage findings.
- [ ] R3. Valid certified evidence still reaches the existing coverage-gate evaluator with its existing path, production include globs, diagnostic shape and 90 percent threshold; Bun's 90/90 line/function thresholds remain unchanged.
- [ ] R4. Certification adds no second full-suite execution or source-count scan. Targeted, heavy, repo-wide and interrupted producers cannot certify canonical coverage or clobber its certified artifact; concurrent canonical producers fail closed or supersede deterministically.
- [ ] R5. Regression fixtures cover producer interruption, nonzero exit, source changes during/after a run, targeted overwrite and concurrent publication. Producer and post-check documentation names the canonical certification route and recovery command.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

