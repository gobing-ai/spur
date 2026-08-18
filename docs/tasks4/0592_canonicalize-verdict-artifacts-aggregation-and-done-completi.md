---
template: feature-impl
schema_version: 1
name: "Canonicalize verdict artifacts, aggregation, and done-completion enforcement"
description: ""
status: todo
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P1
tags: ["task-contract", "verification", "completion-gate"]
dependencies: ["0591"]
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.468Z"
updated_at: "2026-08-18T20:08:35.978Z"
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
- [ ] Inventory every verdict artifact producer/reader and pin current compatibility fixtures, including task 0590, before moving types.
- [ ] Add the canonical Zod schema/normalization result with missing, malformed, invalid-shape, legacy-alias, and valid fixtures.
- [ ] Add table-driven `aggregateVerifyVerdict` coverage for requirement/AC combinations, check severities, legacy checks, task-check failure, and stored/computed disagreement.
- [ ] Make answer derivation and task record parsing/rendering use the canonical contract without changing task 0590's table parser.
- [ ] Replace task-check and feature-check artifact decoding with the same parser and bounded diagnostics.
- [ ] Extend the existing done-transition choke point with target-done TaskCheck, verdict, provenance, and Review enforcement; prove lifecycle, no-lifecycle, direct, record, no-op, and force paths.
- [ ] Reduce workflow predicates to routing-only use and update `docs/04_DESIGN.md`, verdict-schema, code-verification, and task CLI references from tested behavior.
- [ ] Run narrow verdict/record/check/lifecycle/CLI tests first, then `bun run autofix`, `bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
