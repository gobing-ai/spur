---
template: feature-impl
schema_version: 1
name: "Normalize --json and --auto availability across the 28 dev commands"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P2
tags: ["sp-plugin", "commands"]
dependencies: ["0399"]
created_at: "2026-08-01T05:05:18.249Z"
updated_at: "2026-08-01T05:18:40.699Z"
---

## 0402. Normalize --json and --auto availability across the 28 dev commands

### Background

Shared flag coverage is patchy with no stated rule: `--json` appears on 8 of 28 commands, `--auto` on 14. Without a rule, 'normalization' is taste; with one, the gaps are either bugs or recorded decisions.

`--agent` (13/28) is **deferred by operator decision** — entangled with other open agent-dispatch issues, to be settled separately. It must not be touched here.

### Requirements
R1. Apply the task 1 rule: `--json` where the command already produces a structured result a script could consume; `--auto` where it already has at least one HITL gate.
R2. The rule forces a declaration only where the underlying capability already exists. A command that meets the rule and omits the flag is a bug to fix here.
R3. A command that would meet the rule but lacks the underlying capability is recorded as a separate follow-up request — do not build the capability under the banner of consistency. This is the main scope risk in this task.
R4. Every deliberate exception is recorded inline with its reason, so a future reader can tell a decision from an oversight.
R5. Do not add, remove, or alter `--agent` on any command.
R6. Do not retrofit `--next` here — that is task 3. Commands where chaining is meaningless (`dev-changelog`, `dev-daily`, `dev-gitmsg`, …) stay without it.
### Acceptance Criteria
Covers feature scenario R9.

```gherkin
Feature: shared flag vocabulary normalization

  Scenario: --json and --auto follow the stated availability rule
    Given the flags --json and --auto and the stated availability rule
    When the 28 commands are reviewed against it
    Then each command that already has the underlying capability declares the flag
    And each deliberate exception records its reason

  Scenario: Missing capability is recorded rather than built
    Given a command that would meet the rule but lacks the underlying capability
    When the rule is applied
    Then a follow-up request is recorded
    And the capability is not built in this task

  Scenario: --agent coverage is untouched
    Given --agent is deferred from this feature
    When the diff for this task is reviewed
    Then no command's --agent declaration is added, removed, or altered
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
- [ ] Build the capability inventory per command (structured result? HITL gate?) from the command bodies, not from the flag list — the flag list is what is being audited.
- [ ] Classify each of the 28 as: conforms / bug-to-fix / capability-missing / deliberate-exception.
- [ ] Fix the bugs; record the exceptions inline; file the capability-missing set as follow-ups.
- [ ] Confirm `--agent` and `--next` are untouched (`git diff` review).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T05:18:40.699Z todo → cancelled (system)
