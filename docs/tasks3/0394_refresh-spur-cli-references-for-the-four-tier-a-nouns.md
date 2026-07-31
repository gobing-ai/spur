---
template: feature-impl
schema_version: 1
name: "Refresh spur-cli references for the four Tier A nouns"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P1
tags: ["sp-plugin", "skills", "spur-cli"]
dependencies: []
created_at: "2026-07-30T21:52:24.889Z"
updated_at: "2026-07-31T00:22:20.432Z"
---

## 0394. Refresh spur-cli references for the four Tier A nouns

### Background

The `spur-cli` skill has drifted from the CLI. Measured by parsing verbs and flags out of `apps/cli/src/commands/*.ts` and matching them against the skill references:

| Noun | Undocumented verbs | Flag coverage | Phantom flags |
|---|---|---|---|
| task | `verifyall-aggregate`, `scaffold-tests` | 21/28 | 0 |
| feature | `sync` | 13/15 | 0 |
| rule | none | 14/14 | 0 |
| workflow | none | 14/23 | 0 |

The zero-phantom column is the important finding: nothing documented is wrong, so this is not a correctness repair. The failure mode is silent omission — the CLI grows, the skill does not, and nothing notices. That framing sets the scope: fill the gaps here, and gate the class of failure in a later task.

### Requirements
R1. Document `spur task verifyall-aggregate` and `spur task scaffold-tests` in the task reference — purpose, flags, `--json` shape, exit codes.
R2. Document `spur feature sync` in the feature reference to the same standard.
R3. Raise flag coverage to complete for task (28), feature (15), and workflow (23); rule is already complete at 14.
R4. Each flag is cited on a realistic `spur <noun> <verb>` command line, matching the existing reference style, not listed in isolation.
R5. Follow the existing structure — Tier A nouns keep `references/<noun>.md` plus the `references/<noun>/` topic subdirectory.
R6. No phantom flags are introduced: every flag documented must exist in the CLI source.
### Acceptance Criteria
```gherkin
Feature: spur-cli Tier A reference refresh

  Scenario: spur-cli documents every verb of every covered noun
    Given the Tier A nouns are task, feature, rule, and workflow
    When each noun's verbs are parsed from apps/cli/src/commands
    Then each verb appears in that noun's spur-cli reference
    And task verifyall-aggregate, task scaffold-tests, and feature sync are documented

  Scenario: spur-cli documents every flag of every covered noun
    Given task cited 21 of 28 flags, feature 13 of 15, and workflow 14 of 23
    When the refresh lands
    Then every flag of every Tier A noun is cited
    And each is cited on a spur command line rather than listed in isolation

  Scenario: No phantom flags are introduced
    Given the references cited zero non-existent flags before this change
    When the refresh lands
    Then every documented flag exists in the CLI source

  Scenario: Existing structure is preserved
    Given Tier A nouns use references/<noun>.md plus a references/<noun>/ subdirectory
    When the refresh lands
    Then that structure is unchanged
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Scoped to the four Tier A nouns and split from the Tier B promotion so each task has a coherent review surface: this one is gap-filling inside an established structure, while the promotion task creates new structure and makes routing-table decisions.

WHY require realistic command lines (R4): the parity test in a later task detects a flag as covered when it appears on a `spur <noun>` command line. A bare flag list would satisfy a naive check while leaving the reader without usage context — so the citation style and the gate are deliberately aligned to the same standard, and the useful form is the one that passes.

R6 protects the property that makes this corpus trustworthy today. Zero phantoms means an agent can execute straight from the reference without a `--help` round-trip, which is the skill's stated Execute-First Contract. Documenting a flag that does not exist would break that contract more damagingly than omitting one.
### Plan
- [ ] Re-derive the current gap set from `apps/cli/src/commands/*.ts` (counts will have moved)
- [ ] Document `task verifyall-aggregate` and `task scaffold-tests`
- [ ] Document `feature sync`
- [ ] Fill the 7 missing task flags with realistic command lines
- [ ] Fill the 2 missing feature flags
- [ ] Fill the 9 missing workflow flags
- [ ] Verify zero phantoms — every documented flag exists in the CLI source
- [ ] Spot-check a sample of documented invocations against `spur <noun> --help`
### Solution
- **plugins/sp/skills/spur-cli/references/tasks.md** (266 lines) - R1: documents `verifyall-aggregate` and `scaffold-tests`; expanded flag coverage with command-line citations.
- **plugins/sp/skills/spur-cli/references/features.md** (219 lines) - R2: documents `feature sync`; expanded flag coverage to 15 flags.
- **plugins/sp/skills/spur-cli/references/workflows.md** (299 lines) - R3: expanded flag coverage to 23 flags.
- **plugins/sp/skills/spur-cli/references/rules.md** - R3: rule reference already complete at 14 flags.
- **plugins/sp/tests/skill-structure.test.ts:79** - R6: skill structure validation test (44 pass / 0 fail).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-30T23:56:26.700Z todo → wip (system)
- 2026-07-31T00:05:36.292Z wip → testing (system)
- 2026-07-31T00:22:20.432Z testing → done (system)
