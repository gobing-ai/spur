---
template: feature-impl
schema_version: 1
name: "Extend spur-cli/spur-dev parity harness to capture the live CLI surface"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.615Z"
updated_at: "2026-08-11T21:23:28.659Z"
---

## 0512. Extend spur-cli/spur-dev parity harness to capture the live CLI surface

### Background
Phase 1a of feature I2 (parity-first drift audit). Extends the existing parity suite — `command-flag-parity.test.ts`, `flag-contract-parity.test.ts`, `routing-table-parity.test.ts`, `skill-structure.test.ts` (ADR-031/038) — so the facade noun/verb/flag inventories, spine CLI-routed rows, and the AGENTS.md noun table are pinned to the live monorepo CLI surface. Implements: R1 — Facade inventories match the live CLI surface; R2 — CLI-routed spine rows reference real verbs; R4 — AGENTS.md noun inventory matches the CLI; R8 — Facade and spine ownership remain distinct; R9 — Published npm skew is documented; R11 — Explicit facade exclusions do not create false drift; R12 — Non-CLI spine routes do not create false drift; R13 — Surface capture proves source-local provenance.

Per the design doc (`docs/design/plugin-surface-parity.md`): invoke `bun run apps/cli/src/index.ts <noun> --help` directly — never a bare PATH `spur` — and record a provenance header (resolved binary + `@gobing-ai/spur` version) in every capture. Human `--help` parsing is a narrow adapter with fixtures and explicit exclusions, not a general parser; `--json` only where the noun actually exposes a machine-readable inventory. Add at most one shared CLI-surface helper (`plugins/sp/tests/helpers/cli-surface.ts`) and at most one new focused parity test where no existing test owns the assertion — no pre-allocated multi-file test layout. Boundary assertion (R8) checks each surface documents its owned scope and fails on inversion; it does not assert the facade contains no lifecycle steps (status-transition verbs are CLI semantics, facade-owned). No new runtime, dependency, schema, or transport.

Ordering: first task in the batch — the fix and content tasks depend on this harness existing and reporting. Rubric: E3 D1 L1 C0 R0 = 5 → task (whole-unit score 8, D=2 phases; harness independently verifiable before the fixes it exposes).
### Requirements
- [ ] R1. Add `plugins/sp/tests/helpers/cli-surface.ts` to invoke the source-local monorepo CLI, capture noun/verb/flag sets from `--help` (`--json` only where supported), and include the resolved entry path plus `@gobing-ai/spur` version in every result.
- [ ] R2. Add at most one focused `plugins/sp/tests/cli-surface-parity.test.ts`; extend only existing parity tests whose current ownership matches an assertion, reusing their parsers and fixtures instead of duplicating them.
- [ ] R3. Report both `documented-not-on-CLI` and `on-CLI-not-documented` findings for facade inventories, CLI-routed spine rows, and the AGENTS.md noun table.
- [ ] R4. Honor explicit exclusions for Tier C / outside-facade nouns, `--help`-only long-tail nouns, and slash-command or inline spine rows; every exclusion carries a reason.
- [ ] R5. Assert the ADR-054 boundary: `sp:spur-cli` owns noun/verb/flag semantics and `sp:spur-dev` owns multi-step orchestration; status-transition verbs remain facade-owned.
- [ ] R6. Document that published npm `spur` can lag the source-local CLI and is outside this deterministic parity gate.

Non-goals: no runtime CLI behavior, public command or flag, dependency, schema, transport, general-purpose help parser, or pre-allocated test-file family.
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity harness

  Scenario: R1 — Surface capture proves source-local provenance
    Given a stale global spur binary may be on PATH
    When the helper captures a CLI surface
    Then it invokes the monorepo CLI entry directly and records the entry path and package version

  Scenario: R2 — Facade inventories match the live CLI surface
    Given the facade documents noun, verb, and flag inventories
    When the focused parity test compares them with the captured CLI surface
    Then both documented-not-on-CLI and on-CLI-not-documented differences fail the test

  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given a spine routing row is marked as a CLI route
    When its noun and verb are checked against the captured surface
    Then an absent noun or verb fails the test

  Scenario: R3 — AGENTS.md noun inventory matches the CLI
    Given AGENTS.md lists the public Spur CLI nouns
    When the list is compared with the captured root help
    Then a noun present on only one side fails the test

  Scenario: R4 — Explicit facade exclusions do not create false drift
    Given a facade noun is explicitly excluded with a reason
    When parity is evaluated
    Then the noun is not reported as missing documentation

  Scenario: R4 — Non-CLI spine routes do not create false drift
    Given a spine row targets a slash command or inline model-bearing step
    When parity is evaluated
    Then the row is excluded explicitly rather than treated as a missing CLI verb

  Scenario: R5 — Facade and spine ownership remain distinct
    Given the facade and spine state their ADR-054 ownership
    When the boundary assertion runs
    Then ownership inversion fails while facade-owned status-transition verbs remain valid

  Scenario: R6 — Published npm skew is documented
    Given an installed npm Spur may lag the monorepo
    When a maintainer reads the harness contract
    Then it states that the gate validates only the source-local monorepo CLI
```
### Q&A
- **Capture surface:** `--help` is authoritative; use `--json` only for nouns that already expose a machine inventory.
- **Test placement:** one helper plus at most one focused parity test. Existing tests are changed only when the assertion belongs to their current contract.
- **Provenance:** record `apps/cli/src/index.ts` resolution and the workspace package version; never execute a bare PATH `spur`.
- **Deferred:** validation of arbitrary published npm installations is explicitly outside this gate.
### Design
Implement a narrow test-only adapter in `plugins/sp/tests/helpers/cli-surface.ts`. It runs
`bun run apps/cli/src/index.ts [<noun>] --help` from the repository root, parses Commander-style
Commands/Options blocks into stable sets, and returns provenance with the captured surface. Parsing
is fixture-backed and limited to the current CLI help grammar; do not build a generic help parser.

`plugins/sp/tests/cli-surface-parity.test.ts` is the only permitted new focused test. It owns the
root noun comparison, facade noun/verb/flag comparison, and AGENTS.md noun table comparison.
Extend `routing-table-parity.test.ts` only for CLI-marked spine rows; reuse existing helpers from
`command-flag-parity.test.ts`, `flag-contract-parity.test.ts`, and `skill-structure.test.ts` where
their current assertions already own the input format. Exclusions are explicit data with reasons,
never regex silence.

No production package is changed. No new API, CLI surface, dependency, schema, persistence, or
transport is introduced. Task 0513 consumes this task's failing report; task 0514 assumes the live
surface layer is green before content/index cleanup.
### Plan
- [ ] Add fixture-backed source-local CLI capture helper with provenance.
- [ ] Add the single focused parity test and wire bidirectional noun/verb/flag comparisons.
- [ ] Extend the existing routing assertion for explicitly CLI-routed spine rows.
- [ ] Add explicit Tier C, long-tail, slash-command, and inline exclusions with reasons.
- [ ] Assert ADR-054 ownership and published-npm scope.
- [ ] Run the focused plugin parity tests and preserve their failing output for task 0513.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2
- Design: `docs/design/plugin-surface-parity.md` §§1–5, 7–8
- Decisions: ADR-053, ADR-054, ADR-055
- Existing tests: `plugins/sp/tests/{command-flag-parity,flag-contract-parity,routing-table-parity,skill-structure}.test.ts`
- Dependent task: 0513
### History
