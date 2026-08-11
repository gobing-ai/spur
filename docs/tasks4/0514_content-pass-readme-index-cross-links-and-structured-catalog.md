---
template: feature-impl
schema_version: 1
name: "Content pass: README index, cross-links, and structured-catalog ownership"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "content-pass", "plugins/sp"]
dependencies: ["0513"]
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.667Z"
updated_at: "2026-08-11T21:23:32.647Z"
---

## 0514. Content pass: README index, cross-links, and structured-catalog ownership

### Background
Phase 2 of feature I2 — the bounded content/discoverability review that follows the green parity layer. Implements: R5 — README indexes match shipped plugin surfaces; R6 — Plugin cross-links resolve; R7 — Structured catalogs have one owner.

Checks and fixes, bounded per the design doc (§6): every `plugins/sp/README.md` command index entry resolves to a shipped command/skill/agent surface and every shipped surface is indexed; every cross-link in plugin surfaces and the AGENTS.md doc map resolves to an existing file, section, or command; duplicated exact/structured catalogs (verb lists, routing rows, noun tables) are consolidated so one surface owns each and others link to the owner. Arbitrary prose similarity is left to bounded manual review only — mechanical duplication detection is limited to exact catalogs, never general prose. Add no new runtime, dependency, schema, or transport.

Ordering: third task — runs after the drift-fix task so the review covers a settled surface; independent of the harness internals. Rubric: E2 D1 L1 C0 R0 = 4 → task (optional band; kept separate as the goal's explicit phase 2 with its own review gate — merging into the fix task would push it past target_max_hours 8h).
### Requirements
- [ ] R1. Extend the existing README index assertion so every shipped `plugins/sp` command, skill, and subagent is indexed exactly once and every indexed entry resolves.
- [ ] R2. Extend the existing relative-link checks to the plugin surfaces and AGENTS.md doc map in scope; every checked file, heading, command, and skill reference resolves.
- [ ] R3. Identify duplicated exact structured catalogs (noun/verb/flag inventories, routing rows, index tables), retain one owner, and replace other copies with links to that owner.

Non-goals: arbitrary prose-similarity detection, rewriting valid prose, new runtime behavior, dependencies, schemas, or transport.
### Acceptance Criteria
```gherkin
Feature: Plugin content and discoverability pass

  Scenario: R1 — README indexes match shipped plugin surfaces
    Given plugins/sp ships commands, skills, and subagents
    When the README index assertion runs
    Then every shipped surface is indexed exactly once and every entry resolves

  Scenario: R2 — Plugin cross-links resolve
    Given plugin markdown and the AGENTS.md doc map contain checked references
    When the focused link assertion resolves their targets
    Then no checked file, heading, command, or skill reference is missing

  Scenario: R3 — Structured catalogs have one owner
    Given the same exact noun, verb, flag, routing, or index catalog appears on multiple surfaces
    When the content pass completes
    Then one surface owns the catalog and the remaining surfaces link to it
```
### Q&A
- **Existing owners:** `skill-structure.test.ts` R43 owns README index completeness and R16c owns relative Markdown links; extend those assertions instead of adding a new test family.
- **Duplication threshold:** exact tables and machine-comparable inventories only. Similar prose is reviewed manually and is not a finding by itself.
- **Edit boundary:** only files exposed by an index, link, or exact-catalog finding are changed.
### Design
Keep the checks in `plugins/sp/tests/skill-structure.test.ts`: expand R43 from commands to the three
shipped surface directories (`commands`, `skills`, `agents`), and expand R16c only where its current
relative-link resolver can prove file/heading targets. Reuse the same filesystem inventory; do not
add a second crawler or a new test file.

Compare only structured catalogs that can be parsed deterministically: Markdown tables or explicit
lists of nouns, verbs, flags, routes, commands, skills, and agents. The owning surface remains the
one named by ADR-054 or the existing test contract; non-owners link to it. Fix
`plugins/sp/README.md`, plugin markdown, or AGENTS.md only when the focused assertion names the
target. No new API or runtime code. Task 0515 may edit the same planning references, so 0514 leaves
their final text green before that dependent task begins.
### Plan
- [ ] Extend the existing README index inventory to commands, skills, and agents.
- [ ] Extend the existing link resolver for the agreed plugin and AGENTS doc-map scope.
- [ ] Run both checks and capture the exact missing/duplicate targets.
- [ ] Fix only reported indexes, links, and structured catalogs, preserving one owner each.
- [ ] Re-run `skill-structure.test.ts` and the focused parity suite to green.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2
- Design: `docs/design/plugin-surface-parity.md` §§6–8
- Existing owner: `plugins/sp/tests/skill-structure.test.ts` R16c and R43
- Dependency: 0513 (green parity surfaces)
- Dependent task: 0515
### History
