---
schema_version: 1
id: "H11"
name: "Semantic conflict finder: authority-aware indexed audit and confirmed remediation"
status: backlog
priority: P2
tags: []
created_at: "2026-08-09T03:34:12.390Z"
updated_at: "2026-08-09T05:39:00.407Z"
---

# H11: Semantic conflict finder: authority-aware indexed audit and confirmed remediation

## Goal

Ship `/sp:dev-find-conflict` as an indexed, authority-aware command that audits source code, task files, feature files, and project authority files for internal and cross-pillar semantic conflicts/staleness, then routes operator-approved repairs through verified owner surfaces. This is a shippable Wayfinder map: it turns evidence-backed conflict discovery into an honest operator workflow with provenance, ambiguity stops, adaptive coverage, and verified remediation. The map closes only when `/sp:dev-verifyall --feature <id> --fix all` returns `Shippable PASS` (for this feature, `<id>` is `H11`).

## Scope

**In:**

- Any Spur-supported project.
- All four pillars: source code, task files, feature files, and project authority files.
- Key project authority files discovered from `AGENTS.md`, the project constitution, and frontmatter, with these operator-listed defaults: `AGENTS.md`, `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, and `docs/99_PROJECT_CONSTITUTION.md`.
- Within-pillar and cross-pillar contradictions and staleness, including evidence, provenance, confidence, and freshness signals.
- An indexed adaptive scan with an explicit cold rebuild, honest coverage/cost accounting, and fail-loud invalidation rather than silent gaps.
- Interactive confirmation followed by owner-routed remediation; a thin slash command plus a backbone skill where that seam is justified; human and JSON output.

**Out:**

- Replacing linters, typecheck, tests, corpus-check, or doc-evolve.
- Unapproved automatic rewrites.
- A fixed global `docs > features > tasks > code` precedence rule.
- Cross-repository comparison.
- Broad historical cleanup without evidence.

## Acceptance Criteria

```gherkin
Feature: Semantic conflict finder: authority-aware indexed audit and confirmed remediation

  @core
  Scenario: R1 — Complete four-pillar inventory
    Given any Spur-supported project and its discovered or operator-listed authority files
    When the operator runs `/sp:dev-find-conflict` in audit mode
    Then the output inventories source code, task files, feature files, and project authority files
    And every inventory item records its pillar, path, identity, and scan/index status

  @core
  Scenario: R2 — Internal conflicts are reported per pillar
    Given the four-pillar inventory contains potentially related artifacts
    When the finder compares artifacts within each pillar
    Then it reports semantic contradictions and staleness with evidence, severity, confidence, and freshness
    And it does not assert a conflict when the available evidence is insufficient

  @core
  Scenario: R3 — Subject authority graph carries provenance and stops on ambiguity
    Given a subject is stated by more than one authority or owner surface
    When the finder derives the subject-specific authority graph
    Then each authority edge carries its derivation and provenance
    And incomparable or ambiguous edges stop for human-in-the-loop confirmation instead of being ranked by a fixed global precedence

  @core
  Scenario: R4 — Cross-pillar conflicts include reproducible evidence
    Given linked subjects appear across two or more pillars
    When the finder audits cross-pillar consistency
    Then each finding names the subject, conflicting artifacts, authority edges, anchors or excerpts, and freshness context
    And the evidence is sufficient for an operator to reproduce the comparison

  @core
  Scenario: R5 — Indexed adaptive coverage is honest and rebuildable
    Given an index and a prior scan exist for a project
    When the finder runs an adaptive scan or an explicit cold rebuild
    Then it reports the change cone, candidates, coverage, confidence, and cost estimate
    And an invalid or stale index fails loudly and requires a cold rebuild rather than silently reducing coverage

  @core
  Scenario: R6 — Confirmed remediation routes through owners without premature writes
    Given the finder has presented evidence-backed findings and proposed repairs
    When the operator confirms a selected repair set
    Then no corpus, documentation, or source write occurs before confirmation
    And each approved repair routes through its verified owner surface, reports partial failures, and remains resumable and idempotent

  @core
  Scenario: R7 — Thin command, JSON contract, and shippable verification
    Given the command is invoked for human or machine consumption
    When the audit, confirmation, and verification flow completes
    Then the thin slash command delegates to the backbone skill and emits a stable JSON contract containing findings, evidence, provenance, HITL state, and coverage
    And docs and tests cover the flow and `/sp:dev-verifyall --feature <id> --fix all` returns `Shippable PASS` before the feature can close
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->

| WBS  | Task                                                                                             | Status |
| ---- | ------------------------------------------------------------------------------------------------ | ------ |
| 0486 | Ship /sp:dev-find-conflict as an authority-aware indexed audit and confirmed-remediation command | todo   |

<!-- END AUTO-GENERATED -->

## Notes

### Map protocol

This is a live Wayfinder map under the canonical `## Notes` section. One live end-to-end shipping task, 0486, owns the remaining discovery, design, implementation, docs, tests, and verification because the work shares one evidence set and one review boundary. Corpus changes remain CLI-gated, and no repair is applied merely because a finding was detected.

### Decisions so far

- Ship `/sp:dev-find-conflict` as the thin operator command.
- Use confirm-then-route: findings may be proposed, but approved repairs are routed through verified owner surfaces only after explicit operator confirmation.
- Use an indexed adaptive scan with an explicit cold rebuild path.
- Derive a subject-specific authority graph with provenance; ambiguous edges stop for HITL instead of using a universal precedence ladder.
- Operator cohesion ruling (2026-08-08): the work shares one evidence set and one review boundary, so it ships as a single task. Final consolidation: **0486 is the single implementation and verification boundary** — 0487–0489 were never created, and the earlier 0486↔0489 split was retired.

### Open questions

None at map level; operator-only decisions may still surface during 0486.

### Not yet specified

None at map level; 0486 owns the remaining design and implementation details.

### Out of scope

- Replacing linters, typecheck, tests, corpus-check, or doc-evolve.
- Unapproved automatic rewrites.
- A fixed global `docs > features > tasks > code` precedence rule.
- Cross-repository comparison.
- Broad historical cleanup without evidence.

## History
