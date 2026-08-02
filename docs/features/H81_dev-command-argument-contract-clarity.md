---
schema_version: 1
id: "H81"
name: "Dev command argument contract clarity"
status: backlog
priority: P2
tags: []
created_at: "2026-08-02T03:30:35.439Z"
updated_at: "2026-08-02T03:32:35.021Z"
---

# H81: Dev command argument contract clarity

## Goal
Make every `/sp:dev-*` command expose a concise, complete, and mechanically verified argument contract while preserving command Markdown as the source of truth.
## Scope
### In scope

- Migrate all 28 `plugins/sp/commands/dev-*.md` wrappers to syntax-only `argument-hint` values and a dedicated `## Argument Flags` table immediately before `## Usage`.
- Audit every positional argument, canonical flag, compatibility alias, and deprecated spelling against its command, backing skill or inline procedure, workflow, tests, and history.
- Extend the existing command validator and parity tests to enforce heading order, exact table columns, hint-to-table parity, canonical glossary linkage, and all-dev-command coverage.
- Reconcile evidenced drift in the flag glossary, numbered dev-operation contracts, backing skills, workflow aliases, README, ADR, and design documentation.
- Verify Superskill's Codex projection by dry run and run the repository's complete quality gate.

### Out of scope

- A central command registry, generated command Markdown, committed per-platform adapters, or a new dependency/runtime/schema/DTO.
- Advertising a flag whose backing capability does not already exist; record such gaps as follow-up work instead.
- Renaming or removing compatibility spellings without replacement, consumer, history, and migration evidence.
- Migrating non-`dev-*` slash commands or consolidating the 28 command charters.
## Acceptance Criteria
```gherkin
Feature: Clear and coherent dev-command argument contracts

  @core
  Scenario: R1 — Every dev command has the standard argument section
    Given any of the 28 dev command Markdown files
    When the command contract validator parses its body
    Then the only level-two headings are Argument Flags, Usage, and Implementation in that order
    And Argument Flags appears immediately before Usage
    And the Argument Flags table has exactly Flag, Description, and Default columns

  @core
  Scenario: R2 — Argument hints contain syntax rather than documentation links
    Given any dev command frontmatter
    When its argument-hint value is parsed
    Then it contains no Markdown hyperlink or prose definition
    And it contains only canonical positional, flag, alternative, literal, optional, and quoting syntax

  @core
  Scenario: R3 — The hint and table describe the same public invocation
    Given a dev command's canonical argument-hint and Argument Flags table
    When their positional arguments and flags are compared
    Then every canonical hint token has exactly one table row
    And every canonical public table row appears in the hint
    And every row states a deterministic default

  @core
  Scenario: R4 — Shared flag semantics remain canonical and fully covered
    Given a flag declared by at least two of the 28 dev commands
    When command parity tests run
    Then the flag resolves to exactly one canonical glossary entry or an explicitly documented contextual meaning
    And every declaring command contains one mechanically detectable glossary reference
    And availability is derived from all dev command surfaces rather than the numbered operation subset

  @core
  Scenario: R5 — Compatibility inputs are changed only with evidence
    Given a compatibility alias, deprecated no-op, overloaded spelling, or obsolete candidate
    When the semantic audit classifies it
    Then it is retained with mapping and regression evidence or removed with dated replacement, consumer, history, and migration evidence
    And canonical hints omit aliases that are not canonical public syntax

  @core
  Scenario: R6 — Known command-contract contradictions are reconciled
    Given the discovery findings for review target optionality, runall next behavior, wrap dry-run, fixall inputs, dogfood full and save, and glossary membership
    When command, operation, skill, workflow, glossary, and test surfaces are compared
    Then each advertised input has a named consumer and consistent default
    And each existing public consumer input is advertised or explicitly classified as internal or compatibility-only

  @core
  Scenario: R7 — The existing command-as-source architecture is preserved
    Given ADR-032 and the Superskill adapter ownership boundary
    When the migration is implemented
    Then command Markdown remains the hand-editable source of truth
    And no central registry, command generator, new dependency, or committed generated adapter is introduced

  @core
  Scenario: R8 — Surface documentation changes with the contract
    Given the new shared slash-command convention and changed command and flag shapes
    When the feature is implemented
    Then the decision is recorded in the ADR
    And the detailed surface is recorded in the design satellite and design index
    And the plugin README and affected backing references agree with the shipped command files

  @core
  Scenario: R9 — Projection and repository gates pass
    Given the completed atomic migration
    When Superskill performs a Codex dry-run projection and the full repository gate runs
    Then every dev wrapper converts without frontmatter or Markdown-contract errors
    And autofix, spur-check, lint, tests, Cloudflare tests, and build pass
    And only intentional working-tree changes remain
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0412 | Normalize dev-command argument contracts: Argument Flags tables, syntax-only hints, flag audit | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
