---
template: brainstorm
schema_version: 1
name: "dev-find-issue rewrite contract: what the command becomes when the CLI does the extraction"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:03:55.207Z"
updated_at: "2026-08-10T00:06:32.333Z"
---

## 0492. dev-find-issue rewrite contract: what the command becomes when the CLI does the extraction

### Background
**Type:** `wayfinder:research` · **Map:** E2 · **Depends on:** 0491

`plugins/sp/commands/dev-find-issue.md` and the `sp:issue-finding` skill behind it currently do the
whole job in-model: read session logs, spot bottlenecks and anti-patterns, write a structured task
file of proposed fixes. The operator's goal is to make it "simpler but more powerful" by moving the
extraction into the CLI.

That only works once the boundary is known, which is why this ticket sits behind the report-mode
spike: the classification of sample sections into derivable versus model-authored *is* the division of
labor. Whatever the CLI can emit, the command stops prompting for; whatever it cannot, the command
keeps.

Two things make this more than a rewrite. First, map open question 2 is unresolved — whether the
command still writes a task file, or becomes report-first with task creation behind a flag. Second,
this is the map's exit: it is the ticket that turns the three preceding investigations into the
implementation-ready task files that are the destination. The specs are written here or they are not
written at all.

The map's own history is the honest evidence base: the sample report was produced by omp because the
existing command could not produce it. Any rewrite that cannot reproduce that output has not improved
anything.
### Requirements
- R1 — Specify the rewritten command against the CLI contract the preceding tickets settled: which `spur history` invocations it makes, in what order, and what it does with the output.
- R2 — Draw the command / skill / CLI split explicitly, stating what shrinks in `plugins/sp/commands/dev-find-issue.md`, what shrinks or disappears in `sp:issue-finding`, and why the survivor is the right owner of what remains.
- R3 — Resolve, with the operator, whether the command still writes a task file or becomes report-first with task creation optional, and record the ruling rather than assuming it.
- R4 — Show the rewrite reproduces the capability that prompted this map by walking the omp sample through the proposed flow and naming which step produces each of its sections.
- R5 — Emit the implementation-ready task files that are this map's destination, covering the import, analyze, report and command work the map settled, each passing `spur task check --json` with zero errors.
- R6 — State the sequencing and dependencies between those task files so the downstream batch runs in a correct order rather than being re-derived later.
### Acceptance Criteria
```gherkin
Feature: 0492 wayfinder investigation

  Scenario: R1 — the command is specified against a settled contract
    Given the CLI surface the preceding tickets defined
    When the rewritten command is specified
    Then every spur history invocation it makes is named with its flags
    And no invocation depends on behavior no ticket settled

  Scenario: R3 — the task-file question is ruled on, not assumed
    Given the open question about the command's output
    When this ticket is resolved
    Then the operator's ruling is recorded in the task body
    And the map's Decisions so far carries it

  Scenario: R4 — the rewrite reproduces what prompted the map
    Given the omp forensics sample
    When it is walked through the proposed flow
    Then each of its sections is attributed to a producing step
    And any section the flow cannot produce is named as a deliberate loss

  Scenario: R5 — the destination is reached
    Given the decisions the map accumulated
    When the implementation task files are written
    Then each passes spur task check with zero errors
    And together they cover the import, analyze, report and command work
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan

<!-- Follow-up steps or task/feature creation plan once the idea is ready to execute. -->

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
