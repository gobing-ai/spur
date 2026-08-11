---
template: feature-impl
schema_version: 1
name: "Wire facade/spine parity assertions against the captured surface"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0516"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.879Z"
updated_at: "2026-08-11T23:01:33.859Z"
---

## 0517. Wire facade/spine parity assertions against the captured surface

### Background

Split from task 0512 (feature I2, decomposition 2026-08-11): the assertion slice. 0512 owns the capture helper (with provenance); 0516 owns the exclusion data and ADR-054 boundary. This task wires the focused parity test comparing the facade's documented inventories, the spine's CLI-routed rows, and the AGENTS.md noun table against the live captured surface, reporting drift in both directions. Its focused-suite finding set is the input task 0513 consumes.

Implements feature I2 scenarios: R1 (facade inventories match), R2 (CLI-routed spine rows), R4 (AGENTS.md noun inventory). Ordering: after 0516 (assertions consume the exclusion data).

Rubric: E3 D1 L1 C0 R0 = 5 → split (parent scored 5+; size gate).

### Requirements
- [ ] R1. Add the single focused `plugins/sp/tests/cli-surface-parity.test.ts`, importing the 0512/0516 helper API, to compare facade noun/verb/flag inventories with source-local CLI help in both directions.
- [ ] R2. In that focused test, parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing and validate every `kind: 'cli'` noun/verb against captured help; report every non-CLI row explicitly by its retained reason. Do not modify `routing-table-parity.test.ts`, which owns next-router Markdown/adapter parity.
- [ ] R3. Compare the root CLI noun set bidirectionally with both the facade routing/Tier C tables and `AGENTS.md` § Spur CLI surface, honoring only the reasoned exclusions parsed by 0516. Failure output must label `documented-not-on-CLI` and `on-CLI-not-documented` sets.

Non-goals: generic Commander parsing, duplicated exclusion constants, a second focused test file, runtime CLI changes, or reinterpretation of non-CLI spine rows as verbs.
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity assertions
  Scenario: R1 — Facade inventories match the live CLI surface
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
```
### Q&A
- **Test owner:** one new `cli-surface-parity.test.ts` owns live facade/spine/root comparisons. The existing next-router parity test remains unchanged.
- **Facade inventory source:** parse each documented noun's `## Verb map` table and its key-flag cells from `plugins/sp/skills/spur-cli/references/*.md`; use the facade Tier routing table to determine coverage and 0516's Tier C reasons for exclusions.
- **Special nouns:** `init.md` may own both `init` and `status`; Commander-generated `help` is compared at root then excluded only by its Tier C reason.
- **Finding transport:** deterministic assertion messages are the complete finding set consumed by 0513; no parallel report format is introduced.
### Design
Create only `plugins/sp/tests/cli-surface-parity.test.ts`. Import `captureCliSurface`, `parseCommanderHelp`, `parseTierCExclusions`, `parseSpineRoutes`, and `parseOwnershipMarkers` from `tests/helpers/cli-surface.ts`.

Build three deterministic comparisons:

1. Parse the facade noun-routing table and Tier C reasons from `plugins/sp/skills/spur-cli/SKILL.md`; compare their union with root help, with only the parsed Tier C rows treated as reasoned exclusions.
2. For each Tier A/B noun, parse the owned `## Verb map` table in `plugins/sp/skills/spur-cli/references/*.md` (including the combined `init`/`status` reference). Compare documented verbs with `<noun> --help`; for each documented/live verb, compare that row's key flags with `<noun> <verb> --help`. Sort all differences before assertion.
3. Parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing. For each CLI record, capture its noun once and assert its verb exists; retain non-CLI records in the diagnostic with their reason but do not query them as CLI verbs. Parse the `AGENTS.md` noun table between `## Spur CLI surface` and the next H2 and compare it with root help.

Use one small `diffSets` helper local to the focused test and emit both labels even when one side is empty. Cache live capture per command path inside the test process. The source-local entry/version provenance assertion must run for root, noun, and noun+verb captures. Do not add snapshots, a crawler, dependencies, or changes to public/runtime code. The test's sorted failure arrays are 0513's authoritative edit list.
### Plan
- [ ] Add fixture cases for Commander root/noun help to the single focused test, then assert source-local live provenance (0512 R1/R13).
- [ ] Parse and compare facade root nouns plus per-noun verb/flag maps in both directions, using only 0516's reasoned Tier C data (R1/R3).
- [ ] Validate every CLI-classified spine row and the AGENTS.md noun table against captured help; retain reasoned non-CLI rows in diagnostics (R2/R3).
- [ ] Run `bun test plugins/sp/tests/cli-surface-parity.test.ts` and the existing `command-flag-parity`, `flag-contract-parity`, `routing-table-parity`, and `skill-structure` suites.
- [ ] Preserve the complete sorted failure output for 0513; do not correct drift in this task.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenarios R1, R2, R4
- Design: `docs/design/plugin-surface-parity.md` §§1–5, 7–8
- Decisions: ADR-053, ADR-054
- Dependencies: 0512 (capture/provenance), 0516 (scope and ownership parsers)
- Source surfaces: `plugins/sp/skills/spur-cli/{SKILL.md,references/*.md}`; `plugins/sp/skills/spur-dev/SKILL.md`; `AGENTS.md`
- Existing unaffected owner: `plugins/sp/tests/routing-table-parity.test.ts` (next-router table/adapter only)
- Dependent task: 0513
### History
