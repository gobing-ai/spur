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
updated_at: "2026-08-11T23:03:19.432Z"
---

## 0514. Content pass: README index, cross-links, and structured-catalog ownership

### Background
Phase 2 of feature I2 — the bounded content/discoverability review that follows the green parity layer. Implements: R5 — README indexes match shipped plugin surfaces; R6 — Plugin cross-links resolve; R7 — Structured catalogs have one owner.

Checks and fixes, bounded per the design doc (§6): every `plugins/sp/README.md` command index entry resolves to a shipped command/skill/agent surface and every shipped surface is indexed; every cross-link in plugin surfaces and the AGENTS.md doc map resolves to an existing file, section, or command; duplicated exact/structured catalogs (verb lists, routing rows, noun tables) are consolidated so one surface owns each and others link to the owner. Arbitrary prose similarity is left to bounded manual review only — mechanical duplication detection is limited to exact catalogs, never general prose. Add no new runtime, dependency, schema, or transport.

Ordering: third task — runs after the drift-fix task so the review covers a settled surface; independent of the harness internals. Rubric: E2 D1 L1 C0 R0 = 4 → task (optional band; kept separate as the goal's explicit phase 2 with its own review gate — merging into the fix task would push it past target_max_hours 8h).
### Requirements
- [ ] R1. Extend `skill-structure.test.ts` R43 so the existing README tables index every shipped `commands/*.md`, `skills/*/SKILL.md`, and `agents/*.md` entry exactly once within their owning README sections; report both missing shipped entries and indexed names without a shipped target.
- [ ] R2. Extend the existing structural checks rather than adding a crawler: R16c validates relative Markdown file plus heading anchors across plugin Markdown; the AGENTS.md doc-map rows resolve to existing `docs/*.md`; existing R16b continues to own `sp:<skill>` references; R43 owns command/skill/agent index targets.
- [ ] R3. Detect only exact machine-comparable structured catalogs (Markdown noun/verb/flag/routing/index tables or explicit lists). Retain the ADR-054/current-test owner and replace any reported duplicate catalog with a link; do not score arbitrary prose similarity.

Non-goals: new test file, generic Markdown crawler, prose rewriting, runtime behavior, public CLI changes, dependencies, schemas, persistence, or transport.
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
Keep all changes in the existing structural owner `plugins/sp/tests/skill-structure.test.ts` plus Markdown files named by failures.

- Expand R43's existing directory enumeration from commands to three tuples: `commands/*.md` ↔ `### Command index`; `skills/*/SKILL.md` ↔ `#### 1. Skills`; `agents/*.md` ↔ `#### 3. Agents`. Parse only the first backticked name cell in each owning table, then report missing, duplicate, and indexed-without-file entries.
- Extend R16c's current relative-`.md` resolver to validate optional `#heading` fragments using GitHub-style lowercase/hyphen heading slugs. Add the root `AGENTS.md` doc-map paths as a bounded second input and `stat` each backticked `docs/*.md` target. Keep R16b as the skill-reference owner; do not add another skill scanner.
- For structured-catalog ownership, compare only tables/lists explicitly named by ADR-054 or the current tests. When exact duplicates are found, keep the facade verb inventory, spine Step routing, README entity index, or AGENTS noun table as applicable and replace non-owner copies with a link. Similar prose is never a mechanical finding.

Run the assertions first and edit only paths named by their diagnostics. No new test file, parser package, runtime helper, or production code. 0515 may later update planning-workflow guidance; this task leaves the structural suite green before that dependency starts.
### Plan
- [ ] Extend R43 to bidirectionally cover command, skill, and agent README tables against shipped files (R1).
- [ ] Extend R16c for relative heading anchors and the bounded AGENTS.md doc-map paths; retain R16b/R43 as skill/command target owners (R2).
- [ ] Run `bun test plugins/sp/tests/skill-structure.test.ts` and capture exact index/link/catalog findings before editing Markdown.
- [ ] Fix only reported README entries, links/anchors, and exact duplicate catalogs at their named owners (R1–R3).
- [ ] Re-run `skill-structure.test.ts` plus `cli-surface-parity.test.ts`; verify the diff contains no runtime, CLI, schema, dependency, persistence, or transport files, then hand off to 0515.
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
