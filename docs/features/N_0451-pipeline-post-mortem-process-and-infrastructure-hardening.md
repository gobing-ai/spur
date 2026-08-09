---
schema_version: 1
id: "N"
name: "0451 pipeline post-mortem: process and infrastructure hardening"
status: done
priority: P2
tags: []
created_at: "2026-08-06T00:33:02.145Z"
updated_at: "2026-08-09T22:09:49.880Z"
---

# N: 0451 pipeline post-mortem: process and infrastructure hardening

## Goal
Prevent 0451-class pipeline waste: reopen completed features for follow-up work, make verify verdict parsing tolerant of real agent tables, catch shell syntax in workflow validate, and tighten skill authoring contracts for Req tables and Solution citations.
## Scope
- In: feature `done→active` lifecycle edge + pipeline precheck reopen under profile=auto; verdict parser column mapping; workflow validate `sh -n`; L4.feature-terminal messages; verify/implement skill format hardening (task 0453 R1–R6). **Extended 2026-08-07:** corpus-gate correctness — the same "the gate did not do its job" failure shape in the planning half rather than the execution half, in both directions. Covers the ungraduated-wayfinder-fog detector (task 0472, a gate that fails to fire) and the wayfinder-map AC false positive (task 0473, a gate that fires when it must not). The sibling fixes in that thread — `--no-lifecycle` no longer suppressing enforcement, the `corpus-check` corpus sweep, and constitution T10 — landed directly and carry no ticket. **Extended 2026-08-09:** task 0487 hardens target-WBS implement scope, executor authentication and capability sizing, executor-var precedence, one-writer/commit-per-task guidance, dirty-tree diagnostics, and Review/force-done robustness.
- Out: cancelled-feature reopen; full shellcheck; 0452 residual review items; weakening done-feature policy without reopen; H83 product code paths; a `graduated:` frontmatter list on resolved wayfinder tickets (rejected in task 0472 Background — self-reported, checks the wrong half); pasting stub Gherkin into wayfinder maps to satisfy the BDD validator (rejected in task 0473 Background — fabricates acceptance criteria for something that has none); automatic force-done lifecycle traversal.
## Acceptance Criteria
```gherkin
Feature: 0451 pipeline post-mortem process and infrastructure hardening

  Scenario: R1 — feature done→active reopen is legal and used by precheck under auto
    Given feature-lifecycle includes done to active
    And a live task is linked to a done feature
    When precheck runs with profile=auto
    Then the feature is reopened and task check does not fail on L4.feature-terminal

  Scenario: R2 — verdict parser maps Status by header name
    Given a verify table | R# | Severity | Evidence | Status |
    When the verdict parser runs
    Then requirement statuses come from the Status column

  Scenario: R3 — workflow validate catches shell syntax errors
    Given a shell action with invalid sh syntax
    When spur workflow validate runs
    Then validation fails with a state or action reference

  Scenario: R4 — L4.feature-terminal message is actionable for done features
    Given a live task under a done feature
    When spur task check runs
    Then the error suggests spur feature update <id> active

  Scenario: R5 — verify skill mandates canonical Req table header
    Given the code-verification skill is installed
    When an agent authors a per-requirement traceability table
    Then the skill requires | Req | Status | Evidence |

  Scenario: R6 — implement skill mandates backtick path:line in Solution
    Given the code-implementation skill is installed
    When an agent writes the Solution section
    Then citations must use backtick path:line form

  Scenario: R7 — implement stage stays scoped to the target WBS
    Given an implement pass for one task starts in a dirty working tree
    When the agent changes declared and undeclared task surfaces
    Then only changes made during that pass are evaluated
    And undeclared changes fail naming the rogue files

  Scenario: R8 — precheck fails on an unauthenticated executor
    Given either resolved pipeline executor is unauthenticated
    When precheck runs
    Then it records FAIL with the executor and provider detail

  Scenario: R9 — oversized task with a sub-capable executor is blocked
    Given a task exceeds the default size thresholds
    When its implement executor is below capable-1
    Then precheck blocks and requires a capable executor or task split

  Scenario: R10 — explicit `vars.agent` reaches the implement hop
    Given the caller sets agent but not implementAgent
    When workflow vars resolve
    Then the caller agent also seeds implementAgent

  Scenario: R11 — [docs-only] concurrent agent work uses worktree isolation
    Given agent work needs parallel writers
    When project guidance is consulted
    Then each writer uses an isolated git worktree

  Scenario: R12 — dirty-tree precheck warning names non-corpus files
    Given non-corpus changes exist before pipeline launch
    When precheck runs
    Then it warns with the file list without blocking

  Scenario: R13 — Review gate accepts prose severities and parses robustly
    Given a populated Review uses prose priority cells or ends at EOF
    When the done gate parses it
    Then the Review remains populated and complete
    And force-done help names the required lifecycle hops
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0453 | 0451 pipeline post-mortem: process and infrastructure hardening | done |
| 0472 | Detect ungraduated wayfinder fog: fail when a feature's Not-yet-specified shrinks without new tickets | done |
| 0473 | Teach feature check about wayfinder maps so a map's deliberate no-AC contract stops failing the BDD gate | done |
| 0475 | Refine-loop friction: narrow prose-prerequisite heuristic, fix DD-09 for map-parented tasks, add premise-verification to the implement-ready checklist | done |
| 0476 | Skip the DD-09 task-scenario subset check for map-parented tasks | done |
| 0487 | Post-mortem (task 0486): implement-skill sibling-task conflation, precheck auth gate, and large-task executor sizing | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-06T01:37:18.879Z backlog → active (system)
- 2026-08-09T22:09:02.910Z active → verifying (system)
- 2026-08-09T22:09:49.880Z verifying → done (system)
