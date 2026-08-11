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
updated_at: "2026-08-11T23:01:33.304Z"
---

## 0512. Extend spur-cli/spur-dev parity harness to capture the live CLI surface

### Background
Phase 1a of feature I2 (parity-first drift audit). This task owns the capture layer: a fixture-backed source-local CLI helper with provenance, and the npm-skew scope documentation. The assertion and scope slices moved to 0516 (exclusions + ADR-054 boundary) and 0517 (focused parity test wiring) by the 2026-08-11 decomposition; 0513 consumes 0517's finding set.

Implements feature I2 scenarios: R13 (surface capture proves source-local provenance), R9 (published npm skew is documented). Per the design doc (`docs/design/plugin-surface-parity.md`): invoke `bun run apps/cli/src/index.ts <noun> --help` directly — never a bare PATH `spur` — and record a provenance header (resolved binary + `@gobing-ai/spur` version) in every capture. Human `--help` parsing is a narrow adapter with fixtures and explicit exclusions, not a general parser; `--json` only where the noun actually exposes a machine-readable inventory.

Rubric: E3 D1 L1 C0 R0 = 5 → split (size gate: 6 R-items > cap 5); helper slice kept here.
### Requirements
- [ ] R1. Add `plugins/sp/tests/helpers/cli-surface.ts` with exported `captureCliSurface(commandPath?)` and `parseCommanderHelp(text)` helpers. Capture must invoke the repository's `apps/cli/src/index.ts` through Bun for root, noun, or noun+verb help, return stable sorted command/flag arrays, fail loudly on a non-zero command, and attach `{ entryPath, packageName, packageVersion }` provenance read from `apps/cli/package.json`.
- [ ] R2. Document in `docs/design/plugin-surface-parity.md` and the helper contract that published npm `spur` may lag and is outside this deterministic source-local parity gate.

Non-goals: no runtime CLI behavior, public command or flag, dependency, schema, transport, generic help parser, or bare PATH `spur` execution. Assertion wiring and fixture coverage belong to 0517; explicit exclusion and boundary parsing belong to 0516.
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
Create the test-only adapter at `plugins/sp/tests/helpers/cli-surface.ts`. Freeze these exports for downstream tasks:

- `parseCommanderHelp(text: string): { commands: string[]; flags: string[] }` parses only the current Commander `Commands:` and `Options:` blocks, deduplicates, and sorts results.
- `captureCliSurface(commandPath: string[] = []): CliSurfaceCapture` runs `[process.execPath, 'run', <repo>/apps/cli/src/index.ts, ...commandPath, '--help']` with the repository root as `cwd`; the path supports root (`[]`), noun (`['task']`), and noun+verb (`['task', 'update']`) capture. `CliSurfaceCapture` contains the parsed arrays plus provenance `{ entryPath, packageName: '@gobing-ai/spur', packageVersion }`.

Resolve the repository root from `import.meta.dir`; read version `0.3.43` dynamically from `apps/cli/package.json` rather than pinning it. Treat non-zero exit, missing help blocks required by the caller, or unreadable package metadata as test failures with the invoked argv in the message. Do not shell out to a bare `spur`, add a production abstraction, or attempt to parse arbitrary help formats.

0516 extends this same helper with structured scope parsers; 0517 supplies the single focused fixture/live parity suite. No production package changes.
### Plan
- [ ] Implement `parseCommanderHelp` and path-array `captureCliSurface` in `plugins/sp/tests/helpers/cli-surface.ts` (R1).
- [ ] Update `docs/design/plugin-surface-parity.md` only if its existing provenance/npm-skew text needs the frozen helper names added (R2).
- [ ] Run a source-local helper smoke import that captures root help and asserts non-empty commands plus `apps/cli/src/index.ts` / `@gobing-ai/spur@<version>` provenance; fixture/live assertions are completed by 0517.
- [ ] Run `bun test plugins/sp/tests/command-flag-parity.test.ts` to ensure the existing parity layer remains green, then hand the frozen helper API to 0516.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenarios R9 and R13
- Design: `docs/design/plugin-surface-parity.md` §§2–3, 7–8
- Decisions: ADR-053, ADR-054, ADR-055
- Source-local entry/version: `apps/cli/src/index.ts`; `apps/cli/package.json`
- Existing parity tests: `plugins/sp/tests/{command-flag-parity,flag-contract-parity,routing-table-parity,skill-structure}.test.ts`
- Dependent task: 0516 (scope parsers), then 0517 (focused assertions)
### History
