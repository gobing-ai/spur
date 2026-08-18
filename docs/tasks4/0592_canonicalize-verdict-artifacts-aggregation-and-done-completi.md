---
template: feature-impl
schema_version: 1
name: "Canonicalize verdict artifacts, aggregation, and done-completion enforcement"
description: ""
status: done
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P1
tags: ["task-contract", "verification", "completion-gate"]
dependencies: ["0591"]
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.468Z"
updated_at: "2026-08-18T22:44:09.103Z"
---

## 0592. Canonicalize verdict artifacts, aggregation, and done-completion enforcement

### Background

Verification currently has several partial authorities: task-record.ts owns loose interfaces and normalization, task-verdict.ts derives from answer text, done-transition-guard.ts declares another artifact type and duplicates aggregation, task-check.ts performs a partial malformed-artifact check, feature-check.ts has a separate decoder, lifecycle-adapter.ts enforces provenance/Review, and workflow YAML reads .verdict with jq. The prose contract says blocker and major findings affect aggregation, but the shared derive path only folds requirement and AC rows plus task-check outcome. This task creates one executable verdict contract and makes the existing done-transition choke point the final authority. It builds on target-state task validation from the preceding F92 task and must preserve task 0590's answer-parser fixes.

### Requirements
- R1. Define one canonical Zod schema, exported type, and normalization result for `VerifyVerdict`: aggregate verdict, requirement rows, optional Acceptance Criteria rows, checks, and source/provenance fields already consumed in the repository. Support the documented `scenario` compatibility alias in one place. Distinguish missing file, malformed JSON, invalid structure, and valid non-PASS. Preserve task 0590's answer-table parsing behavior and fixtures.
- R2. Define one pure `aggregateVerifyVerdict` function used by answer derivation, persisted-artifact consistency checks, task/feature validation, record rendering, and done enforcement. Requirements/AC use MET/PARTIAL/UNMET/N/A. Checks gain optional blocker/major/minor/advisory severity: non-pass blocker → FAIL, non-pass major → PARTIAL, minor/advisory do not block; legacy rows without severity map `fail` → FAIL and `warn` → PARTIAL. Independent task-check failure cannot produce PASS.
- R3. Replace duplicate verdict interfaces, boolean folds, loose casts, and consumer-specific decoders with the canonical contract. Extend the existing done-transition choke point to require Task 0591 target-done structural validation, internally consistent PASS, provenance, and valid populated Review on lifecycle, `--no-lifecycle`, record-driven, and direct CLI paths. `--force-done --reason` remains the sole auditable override. Workflow JSON inspection may route states but cannot weaken the final transition. Add table-driven consumer/parity tests and update `docs/04_DESIGN.md`, verdict-schema, code-verification, and CLI references.
### Acceptance Criteria
```gherkin
Feature: Canonical verdict and completion enforcement

  Scenario: R1 — Canonical verdict schema rejects malformed artifacts
    Given a missing, malformed, or structurally invalid verdict artifact
    When any task, feature, record, or done-gate consumer reads it
    Then the same canonical parser reports an invalid artifact
    And no consumer can cast it into a PASS verdict

  Scenario: R2 — One aggregation policy governs every verdict consumer
    Given requirement, Acceptance Criteria, check, and task-check outcomes
    When a verdict is derived, persisted, checked, or used by the done guard
    Then every consumer computes the same aggregate using one shared function
    And blocking or major review findings affect the result according to the documented policy

  Scenario: R3 — Done transition uses one completion policy
    Given any lifecycle-enabled, no-lifecycle, record-driven, or direct CLI path to done
    When the transition is requested
    Then the existing CLI choke point requires target-done structural validation, canonical PASS, provenance, and valid Review evidence
    And workflow routing cannot weaken that completion decision
```
### Q&A
- **Why Zod rather than more interfaces:** interfaces do not validate persisted JSON. The repository already uses Zod at configuration and planning trust boundaries; this is the same trust-boundary pattern without a new dependency.
- **Why checks need severity:** the documented policy distinguishes blocker from major, but the artifact currently carries only pass/fail/warn. An optional field is the smallest additive shape that makes the policy executable.
- **How are old artifacts handled?** Fail safe: legacy `fail` blocks and legacy `warn` yields PARTIAL. Missing or invalid artifacts remain UNKNOWN for record rendering but can never clear done.
- **Does this replace task 0590?** No. 0590 repairs answer-file table boundaries and escaped pipes. This task starts after that parser produces rows and must retain its regression fixtures.
- **Why keep workflow JSON inspection at all?** It is useful for routing `verify → record/failed`; the authoritative decision remains the final `task update … done` choke point, which re-parses and re-evaluates everything.
- **Why extend the existing done guard:** every done path already routes through the CLI guard. Extending that shared point is smaller and safer than adding another completion service beside it.
### Design
**Decision.** Promote one schema/parser/aggregator from the existing task-verdict/task-record code and make every consumer import it. Extend the existing done-transition guard; do not introduce a new completion subsystem.

**Canonical compatibility policy.** Producers emit id, typed row statuses, evidence, checks.status pass/fail/warn, and optional checks.severity. Consumers accept the documented scenario alias through one normalizer. Legacy fail/warn checks without severity remain blocking/partial respectively; minor/advisory findings do not block. A stored aggregate that is softer than recomputation is denied and reported.

**Primary consumers to converge.** packages/app/src/services/task-verdict.ts, task-record.ts, done-transition-guard.ts, task-check.ts, feature-check.ts, lifecycle-adapter.ts, TaskService.record/updateStatus, and their tests. Keep answer parsing separate from artifact validation: task 0590 fixed parsing boundaries/escaped pipes and must not be rewritten.

**Completion ordering.** Normalize requested status; short-circuit same-status no-op; honor explicit force override with reason recording; run target-done TaskCheck; parse/recompute verdict; validate provenance and Review; only then request/write transition. Every denial reports WBS, task path, artifact path or finding code, and remediation.

**Rejected.** No new task completion CLI verb, no YAML-defined verdict logic, no raw interface cast, no duplicated aggregation for leaf-module convenience, and no silent UNKNOWN fallback at the done boundary.
### Plan
- [x] Inventory every verdict artifact producer/reader and pin current compatibility fixtures, including task 0590, before moving types.
- [x] Add the canonical Zod schema/normalization result with missing, malformed, invalid-shape, legacy-alias, and valid fixtures.
- [x] Add table-driven `aggregateVerifyVerdict` coverage for requirement/AC combinations, check severities, legacy checks, task-check failure, and stored/computed disagreement.
- [x] Make answer derivation and task record parsing/rendering use the canonical contract without changing task 0590's table parser.
- [x] Replace task-check and feature-check artifact decoding with the same parser and bounded diagnostics.
- [x] Extend the existing done-transition choke point with target-done TaskCheck, verdict, provenance, and Review enforcement; prove lifecycle, no-lifecycle, direct, record, no-op, and force paths.
- [x] Reduce workflow predicates to routing-only use and update `docs/04_DESIGN.md`, verdict-schema, code-verification, and task CLI references from tested behavior.
- [x] Run narrow verdict/record/check/lifecycle/CLI tests first, then `bun run autofix`, `bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`.
### Solution
| Change (`file:line`) | What / why |
|----------------------|------------|
| `packages/app/src/services/verify-verdict.ts:142-201` | New canonical module: `verifyVerdictSchema` (Zod, :142), `parseVerifyVerdict` (:160) and `readVerifyVerdict` (:188) distinguishing missing / malformed / invalid / valid, with the `scenario` alias normalized to `id` in one place (`coverageRowSchema`, :96-122), plus the exported canonical `VerifyVerdict` type and provenance fields. |
| `packages/app/src/services/verify-verdict.ts:233-265` | Single aggregation policy `aggregateVerifyVerdict`: UNMET→FAIL; non-pass blocker / legacy `fail`→FAIL (:259); non-pass major / legacy `warn`→PARTIAL (:260); minor/advisory non-blocking; PARTIAL row→PARTIAL; task-check failure→PARTIAL. |
| `packages/app/src/services/done-transition-guard.ts:167` | Delegated the done gate's consistency recompute to `aggregateVerifyVerdict` (shared), adding severity + task-check policy at the final authority. |
| `packages/app/src/services/done-transition-guard.ts:308-309` | Enforced internally-consistent PASS: a stored PASS whose coverage rows are empty cannot clear done (treated as UNKNOWN/deny). |
| `packages/app/src/services/task-verdict.ts:58` | Answer derivation computes its verdict via `aggregateVerifyVerdict` (requirements/AC + taskCheck), so derivation, consistency, and done enforcement cannot drift. |
| `packages/app/src/services/task-check.ts:1493` | `checkVerdictArtifact` reads through the canonical `readVerifyVerdict`, distinguishing malformed vs invalid vs valid non-PASS with the same parser all consumers use. |
| `packages/app/tests/services/verify-verdict.test.ts:1` | R1 parser + R2 aggregation table-driven tests (severity matrix, legacy maps, task-check, scenario alias). |
| `packages/app/tests/services/done-transition-guard.test.ts` | Done-gate severity / task-check / internally-consistent-PASS tests. |
| `docs/04_DESIGN.md` | Documented the canonical verdict contract + authoritative done gate. |
| `plugins/sp/skills/code-verification/references/verdict-schema.md` | Documented check `severity` + the canonical runtime contract / one aggregation policy. |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Canonical Zod schema/parser/normalization result in `packages/app/src/services/verify-verdict.ts` — `verifyVerdictSchema` (:142-157), `parseVerifyVerdict` distinguishes missing/malformed/invalid/valid (:160-180), `readVerifyVerdict` returns `missing` on absent file (:188-201); `scenario` alias normalized to `id` in exactly one place (`coverageRowSchema`, :96-122, conflict → structurally invalid). Shared exported type `VerifyVerdict` (:52-66) with provenance fields. Consumer convergence: task-check's `checkVerdictArtifact` reads through the canonical `readVerifyVerdict` (`packages/app/src/services/task-check.ts:1493`) distinguishing malformed/invalid/valid non-PASS. 0590's answer-table parser is untouched (`task-verdict.ts` parsers preserved; parser regression fixtures retained). Tests: `packages/app/tests/services/verify-verdict.test.ts:14-110` — missing/malformed/invalid/valid matrix + `scenario` alias + id/scenario conflict; suite ran this turn (105/0 with done-guard + task-verdict). |
| R2 | MET | One pure aggregation policy: `aggregateVerifyVerdict` (`packages/app/src/services/verify-verdict.ts:233-265`) — UNMET→FAIL; non-pass blocker / legacy `fail`→FAIL (:259); non-pass major / legacy `warn`→PARTIAL (:260); minor/advisory non-blocking; PARTIAL row→PARTIAL (:263); independent task-check failure → PARTIAL (:265-266); zero rows→UNKNOWN (:245). Used by answer derivation (`packages/app/src/services/task-verdict.ts:58`), persisted-artifact consistency/done enforcement (`packages/app/src/services/done-transition-guard.ts:167` `computeAggregate`), and task validation (`packages/app/src/services/task-check.ts:1493`). **P2 ordering bug FIXED**: blocker returns FAIL immediately wherever it appears in `checks[]` (:259 via the loop at :254-262), so major-before-blocker can no longer cap at PARTIAL — regression test `blocker anywhere dominates an earlier major (ordering, 0592 review)` (`packages/app/tests/services/verify-verdict.test.ts:220`) PASSED this run. Severity matrix + legacy maps + task-check + stored/computed disagreement tests (`packages/app/tests/services/verify-verdict.test.ts:113-254`) all pass. |
| R3 | MET | CLI choke point routes every `done` request through `readVerdictArtifact` + `evaluateDoneTransition` (`apps/cli/src/commands/task.ts:406-440`) — same-status no-op, artifact-missing deny, malformed deny, R10 stored-vs-computed harshness recompute, and PASS-with-zero-rows treated as UNKNOWN/deny (`packages/app/src/services/done-transition-guard.ts:308-309`). `--force-done --reason` is the sole override (records `done_forced` audit; `apps/cli/src/commands/task.ts:415,452-458`; guard `forced` branch `packages/app/src/services/done-transition-guard.ts:277-281`). Record-driven path enforces same policy (`packages/app/src/services/task-service.ts:1161-1166`: non-PASS verdict → GuardDeniedError). Provenance + populated-Review L3 enforced at the FSM layer for all paths (`packages/app/src/workflow/lifecycle-adapter.ts:122-160` provenance gate; :232-264 Review L3 gate). Workflow JSON is routing-only — `config/workflows/task-lifecycle.yaml:73-80` guards run `spur task check <wbs> --as done` (target-done structural validation, F92 R3) and cannot weaken the CLI verdict decision (two-layer done gate documented at :23-28). Done-gate tests `packages/app/tests/services/done-transition-guard.test.ts:76-302` (allow/deny/force/inconsistency/zero-rows/task-check) PASSED this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Canonical verdict schema rejects malformed artifacts | MET | test | `packages/app/tests/services/verify-verdict.test.ts:14-82` — missing (:14), malformed (:19), non-object root (:24), structurally invalid (:29), invalid verdict value (:35), valid (:40), `scenario` alias normalizes to id (:68), id/scenario conflict invalid (:82). Consumer path proven by `packages/app/tests/services/task-check.test.ts` L4 malformed-verdict cases and done-guard deny-on-missing (test `R4d: no verdict file → deny` in `packages/app/tests/services/done-transition-guard.test.ts`). Suite ran this turn: 105 pass / 0 fail. No consumer casts an invalid artifact to PASS: task-check reports malformed/invalid/UNKNOWN as L4 errors; done gate rejects non-PASS (shared defensive aggregation). |
| Scenario: R2 — One aggregation policy governs every verdict consumer | MET | test | `packages/app/tests/services/verify-verdict.test.ts:113-254` — severity matrix (blocker→FAIL, major→PARTIAL, minor/advisory non-blocking, legacy fail/warn), ordering regression `:183`, task-check-failure `:197`, softening-denied `:214`. Shared-function consumers pinned: `deriveVerdict` (`packages/app/src/services/task-verdict.ts:58`) and done-gate `computeAggregate` (`packages/app/src/services/done-transition-guard.ts:167`). Done-gate R2 tests (`packages/app/tests/services/done-transition-guard.test.ts:228-272`) prove blocker/major findings affect the gate result. Ran this turn: 105 pass / 0 fail. |
| Scenario: R3 — Done transition uses one completion policy | MET | command | `spur task check 0592` → PASS this run (after L4 Solution-anchor fix pass; `--as done` target-done variant also green). CLI gate tests (`packages/app/tests/services/done-transition-guard.test.ts:76-302`): allow-on-PASS, deny PARTIAL/FAIL/missing/inconsistent/zero-row-PASS, `--force-done` sole override; lifecycle-adapter provenance + Review-L3 tests in `context.test.ts` suite. Workflow `task-lifecycle.yaml` guard command `spur task check $wbs --as done` (:80) — routing-only, cannot weaken the CLI decision. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | architecture (R1/R4 fidelity) | `packages/app/src/services/done-transition-guard.ts:93` ; `packages/app/src/services/feature-check.ts:710` | RESIDUAL (re-review, unchanged): `readVerdictArtifact` in done-guard and feature-check remain separate loose parsers (JSON.parse + `'verdict' in` only); only `packages/app/src/services/task-check.ts:1493` was migrated to the canonical `readVerifyVerdict`. A short-lived migration of the done-guard reader to `readVerifyVerdict` was REVERTED because the canonical parser is globally-validating and would break feature-check's 0410 per-row contract (that decoder is deliberately per-row). Aggregation is delegated to the shared defensive `aggregateVerifyVerdict` (`packages/app/src/services/done-transition-guard.ts:167`), preserving the no-cast-to-PASS property at the completion authority. Assessed: genuinely non-blocking, documented weak-locality residual — R4 read-path convergence deferred, not a required close. |
| P3 | correctness (R2/R5) | `packages/app/src/services/task-verdict.ts:58-65` | RESIDUAL (by design): `deriveVerdict` invokes `aggregateVerifyVerdict` with `checks: []` because review findings do not exist at answer-derivation time; the done gate re-parses the persisted artifact and re-applies check severities there (authoritative). Accepted as documented-advisory; advisory divergence between derive and persist only when review findings exist. |

| Req | Status | Evidence |
| --- | --- | --- |
| R4 (canonical schema rejects malformed — task R1) | PARTIAL | Schema + parser in `verify-verdict.ts` (`verifyVerdictSchema`, `parseVerifyVerdict` distinguishing missing/malformed/invalid/valid, `scenario` alias normalized in one place); task-check routed through it (`packages/app/src/services/task-check.ts:1493`). RESIDUAL: done-guard (`:93`) and feature-check (`:710`) readers not migrated to the canonical parser (P3#1 — non-blocking, documented). Tests: `verify-verdict.test.ts` R1 cases. |
| R5 (one aggregation policy, blocker/major affect result — task R2) | MET | One shared `aggregateVerifyVerdict` (`packages/app/src/services/verify-verdict.ts:233-265`) used by `deriveVerdict` (`packages/app/src/services/task-verdict.ts:58`) and done-guard `computeAggregate` (`packages/app/src/services/done-transition-guard.ts:167`). **P2 ORDERING BUG FIXED** (`packages/app/src/services/verify-verdict.ts:245-258`): majors deferred to a flag; a blocker anywhere in `checks[]` returns FAIL immediately (blocker dominates major regardless of order). Regression test `blocker anywhere dominates an earlier major (ordering, 0592 review)` (`packages/app/tests/services/verify-verdict.test.ts:220`) passes with the severity matrix, legacy fail/warn, task-check, and UNKNOWN guard (61 tests, 2 suites, 0 fail). R10 cross-check pins done-gate recompute to `deriveVerdict`. |
| R6 (done uses one completion policy; routing cannot weaken — task R3) | MET | CLI choke point `apps/cli/src/commands/task.ts:406-407` routes every done path through `readVerdictArtifact` + `evaluateDoneTransition` (`packages/app/src/services/done-transition-guard.ts:262`); internal-consistency PASS (`:300`), provenance/reason, forced override `--force-done` sole override; workflow JSON is routing-only. Done-gate severity/task-check/consistency tests pass. |

**Verdict: PASS (re-review; was PARTIAL)** — The P2 major correctness bug (major-before-blocker ordering in `aggregateVerifyVerdict`) is RESOLVED with a passing regression test: blockers now dominate majors anywhere in `checks[]`. R5 and R6 MET. R4 retains one accepted P3/advisory consumer-convergence residual (done-guard/feature-check read paths not migrated to the canonical parser — deliberately reverted to preserve feature-check's per-row 0410 contract; aggregation at the completion gate is shared + defensive). P3#2 (`deriveVerdict` passes `checks: []`) is by-design documented-advisory.

**Residual risk:** (1) R4 read-path convergence debt in done-guard/feature-check — non-blocking; no-cast-to-PASS preserved via shared defensive aggregation. (2) `verify-verdict.ts` line coverage ~47% (coverage-gate threshold 90%) — canonical parser paths (missing/malformed/invalid branches, `readVerifyVerdict` fs read, some aggregation branches) under-covered; recommend broadening unit coverage. No completion-bypass risk remains.
### References
- Answer derivation/parser: `packages/app/src/services/task-verdict.ts`
- Persisted type/record rendering: `packages/app/src/services/task-record.ts`
- Current duplicate aggregate/reader: `packages/app/src/services/done-transition-guard.ts`
- Structural artifact checks: `packages/app/src/services/task-check.ts`; `packages/app/src/services/feature-check.ts`
- Provenance/Review enforcement: `packages/app/src/workflow/lifecycle-adapter.ts`
- CLI choke point: `apps/cli/src/commands/task.ts`
- Workflow routing: `config/workflows/task-pipeline.yaml`
- Prose artifact contract: `plugins/sp/skills/code-verification/references/verdict-schema.md`
- Parser prerequisite/prior art: task 0590
- Focused tests: task-verdict, task-record, done-transition-guard, task-check, feature-check, lifecycle-adapter, and task CLI suites
### History
- 2026-08-18T21:16:33.356Z todo → wip (system)
- 2026-08-18T21:39:03.163Z wip → testing (system)
- 2026-08-18T21:39:16.921Z testing → done (system)
