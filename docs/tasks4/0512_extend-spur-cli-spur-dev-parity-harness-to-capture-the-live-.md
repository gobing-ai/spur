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
updated_at: "2026-08-11T22:26:15.207Z"
---

## 0512. Extend spur-cli/spur-dev parity harness to capture the live CLI surface

### Background
Phase 1a of feature I2 (parity-first drift audit). This task owns the capture layer: a fixture-backed source-local CLI helper with provenance, and the npm-skew scope documentation. The assertion and scope slices moved to 0516 (exclusions + ADR-054 boundary) and 0517 (focused parity test wiring) by the 2026-08-11 decomposition; 0513 consumes 0517's finding set.

Implements feature I2 scenarios: R13 (surface capture proves source-local provenance), R9 (published npm skew is documented). Per the design doc (`docs/design/plugin-surface-parity.md`): invoke `bun run apps/cli/src/index.ts <noun> --help` directly — never a bare PATH `spur` — and record a provenance header (resolved binary + `@gobing-ai/spur` version) in every capture. Human `--help` parsing is a narrow adapter with fixtures and explicit exclusions, not a general parser; `--json` only where the noun actually exposes a machine-readable inventory.

Rubric: E3 D1 L1 C0 R0 = 5 → split (size gate: 6 R-items > cap 5); helper slice kept here.
### Requirements
- [ ] R1. Add `plugins/sp/tests/helpers/cli-surface.ts` to invoke the source-local monorepo CLI, capture noun/verb/flag sets from `--help` (`--json` only where supported), and include the resolved entry path plus `@gobing-ai/spur` version in every result.
- [ ] R2. Document that published npm `spur` can lag the source-local CLI and is outside this deterministic parity gate.

Non-goals: no runtime CLI behavior, public command or flag, dependency, schema, transport, general-purpose help parser, or pre-allocated test-file family (assertions live in 0517; exclusions and boundary in 0516).
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity harness

  Scenario: R1 — Surface capture proves source-local provenance
    Given a stale global spur binary may be on PATH
    When the helper captures a CLI surface
    Then it invokes the monorepo CLI entry directly and records the entry path and package version

  Scenario: R2 — Published npm skew is documented
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

Rejected: executing a bare PATH `spur` (provenance cannot be proven — the resolved binary and
package version must be recorded); a general-purpose help parser (overkill for a narrow
fixture-backed adapter). No production package is changed.
### Plan
- [ ] Add fixture-backed source-local CLI capture helper with provenance.
- [ ] Document npm-skew scope in the harness contract.
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
