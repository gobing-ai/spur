---
schema_version: 1
id: "I9"
name: "Environment-improvement lens: retro categories in dogfood and history-anatomy reports"
status: done
priority: P2
tags: []
created_at: "2026-08-27T00:15:00.420Z"
updated_at: "2026-08-27T03:04:14.060Z"
---

# I9: Environment-improvement lens: retro categories in dogfood and history-anatomy reports

## Goal

Give dogfood-testing and history-anatomy a shared, proposal-only environment-improvement lens — retro's seven categories plus the implementer-versus-reviewer placement rule — so steering, navigation, and standards remediations are classified as environment changes rather than implementer bugs, without a third skill or SKILL.md growth.

## Scope

**In scope:**

- One plugin-level mapping SSOT for retro's seven categories (navigation, automated checks, coding standards, AGENTS.md placement, tool economy, no-ops, information access) and the implementer-versus-reviewer placement rule.
- Project that mapping into `sp:dogfood-testing` via `references/report-template.md` §6 Findings as additive, optional environment-versus-testee-versus-waste tags; protocol stays `sp:dogfood-testing@1.2`.
- Project that mapping into `sp:history-anatomy` via `references/report-contract.md` section 9 (workflow and process improvements): retro names become `<signal>` / owner-surface values, not a new category enum. Closed vocabulary (`reliability | repetition | workflow | performance | coverage | telemetry | positive`) stays frozen.
- Environment remediations remain operator proposals only; dogfood fix-mode must not apply them as tree mutations.
- Leave `sp:issue-finding` untouched (coexistence-window skill; `/sp:dev-find-issue` already wraps history-anatomy).
- Fixtures and structural tests that prove the mapping is single-sourced and that the two named `SKILL.md` bodies do not grow past their BODY_BUDGET baselines.

**Out of scope:**

- A third analysis skill (`sp:retro`) or a `/sp:dev-retro` command (ADR-016 / ADR-051 consent).
- Importing `CODING_STANDARDS.md` or a `writing-for-agents` dependency from the vendor skill.
- Growing `plugins/sp/skills/dogfood-testing/SKILL.md` or `plugins/sp/skills/issue-finding/SKILL.md` (both BODY_BUDGET-baselined).
- Unfreezing history-anatomy's closed category vocabulary or adding a new finding category.
- Bumping the dogfood protocol off `@1.2`.
- Auto-applying environment remediations, mutating the corpus/docs/sources from a report, or mixing a second mutation source into dogfood fix-mode.
- Folding this lens into wrap-up learnings or gitignored `.spur/context/` memory.
- Public CLI noun/verb/flag changes.

## Acceptance Criteria

```gherkin
Feature: Environment-improvement lens: retro categories in dogfood and history-anatomy reports

  # --- Mapping SSOT ---

  @core
  Scenario: R1 — A single plugin-level mapping owns the seven retro categories and the placement rule
    Given the sp plugin tree
    When structural tests load the environment-improvement mapping
    Then exactly one file under "plugins/sp/references/" enumerates the seven categories navigation, automated checks, coding standards, AGENTS.md placement, tool economy, no-ops, and information access
    And that file states the implementer-versus-reviewer placement rule: prefer an automated check over a new always-loaded sentence, place coding standards on the review path not the implementer skill, and keep AGENTS.md as navigation pointers
    And no other file restates those seven names as a second category table

  @core
  Scenario: R2 — Dogfood and history-anatomy projections point at the mapping rather than duplicating it
    Given the plugin-level environment-improvement mapping
    When structural tests scan "plugins/sp/skills/dogfood-testing/references/report-template.md" and "plugins/sp/skills/history-anatomy/references/report-contract.md"
    Then each projection names that mapping file as the category table
    And neither file redefines the seven retro names with different wording

  # --- Dogfood projection ---

  @core
  Scenario: R3 — A dogfood section 6 finding may carry an optional environment, testee, or waste tag without leaving protocol @1.2
    Given a dogfood run of a skill or command testee under protocol "sp:dogfood-testing@1.2"
    When the driver records a section 6 Findings line tagged "environment", "testee", or "waste"
    Then "validate-report.mjs" accepts the report
    And the report frontmatter protocol remains "sp:dogfood-testing@1.2"

  @core
  Scenario: R4 — An untagged dogfood report remains valid under protocol @1.2
    Given a well-formed "sp:dogfood-testing@1.2" report whose section 6 findings carry no environment, testee, or waste tag
    When "validate-report.mjs" checks the report
    Then the report is accepted
    And those tags are not required fields

  @core
  Scenario: R5 — Dogfood fix-mode does not apply environment-tagged findings as tree mutations
    Given a dogfood run in fix mode that produced an environment-tagged finding
    When the driver applies bounded retries
    Then the driver does not Edit or Write AGENTS.md, skills, rules, or other environment sources for that finding
    And the finding remains a recommended action in section 6 Findings

  # --- History-anatomy projection ---

  @core
  Scenario: R6 — History-anatomy encodes retro names as signal or owner-surface values and rejects them as categories
    Given the closed finding vocabulary "reliability", "repetition", "workflow", "performance", "coverage", "telemetry", and "positive"
    When the structure gate checks section 9 candidates
    Then a finding whose category is one of those seven values and whose stable-key owner-surface or signal carries a retro name passes
    And a finding whose category is a retro name such as "navigation" fails
    And the closed vocabulary in "plugins/sp/skills/history-anatomy/references/report-contract.md" is unchanged

  @core
  Scenario: R7 — History-anatomy environment remediations remain operator proposals
    Given a history-anatomy report whose section 9 carries a candidate projected from the environment lens
    When the report is published
    Then each such remediation names an owner surface, expected impact, verification method, and reversibility
    And the report contains no applied change, no diff, and no command it claims to have run

  # --- Classification ---

  @core
  Scenario: R8 — Steering, navigation, and coding-standards remediations are classified as environment changes, not implementer bugs
    Given a dogfood run of a skill or command testee that exhibited a navigation delay, a dead always-loaded instruction, or a missed coding standard
    When the driver records those candidates in section 6 Findings
    Then each is tagged "environment" rather than "testee"
    And a coding-standards finding names a review owner surface ("sp:code-verification", "sp:code-review", or pipeline review), never the implementer skill

  @core
  Scenario: R9 — An automated-check candidate proposes a gate rather than a new always-loaded sentence
    Given a session mistake a linter, typechecker, test, or filesystem linter could have caught
    When the environment lens classifies the candidate
    Then the recommended action is a new or tighter check
    And the action is not a new sentence in AGENTS.md or another always-loaded steering file

  # --- Untouched surfaces and BODY_BUDGET ---

  @core
  Scenario: R10 — sp:issue-finding stays a coexistence-window non-target
    Given the skill at "plugins/sp/skills/issue-finding/"
    When structural tests inspect that skill
    Then "SKILL.md" byte size does not exceed the BODY_BUDGET baseline of 27,060
    And the skill gains no new finding category, flag, or environment-lens projection

  @core
  Scenario: R11 — The two named SKILL.md bodies do not grow past their BODY_BUDGET baselines
    Given the skill-structure BODY_BUDGET baselines "dogfood-testing" 37,452 and "issue-finding" 27,060
    When the skill-structure suite runs
    Then neither body exceeds its listed baseline
    And the mapping and both projections live outside those two SKILL.md files

  @edge
  Scenario: R12 — A history-anatomy fixture that uses only the closed category vocabulary still passes the structure gate
    Given a history-anatomy report fixture whose findings use only "reliability", "repetition", "workflow", "performance", "coverage", "telemetry", and "positive"
    When the structure gate runs
    Then the fixture passes
    And no finding is required to carry a retro signal

  @edge
  Scenario: R13 — history-anatomy SKILL.md stays a dispatcher and does not absorb the mapping
    Given "plugins/sp/skills/history-anatomy/SKILL.md"
    When the BODY_BUDGET dispatcher-shape check runs
    Then the body remains under 20,000 bytes
    And the seven retro categories are not copied into that SKILL.md

  @edge
  Scenario: R14 — Existing cache-health P3 findings remain valid without a waste tag
    Given a dogfood report whose section 6 includes the cache-health P3 for aggregate cache percent below 50
    When "validate-report.mjs" checks the report
    Then the report is accepted
    And that P3 does not require an environment or waste tag
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0686 | Project the environment-improvement lens into dogfood and history-anatomy reports | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-08-27T00:15:21.528Z moved L → I9 (system)
- 2026-08-27T02:11:33.460Z backlog → active (system)
- 2026-08-27T02:27:55.953Z active → verifying (system)
- 2026-08-27T03:04:14.060Z verifying → done (system)
