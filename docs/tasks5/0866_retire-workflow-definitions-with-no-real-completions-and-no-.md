---
schema_version: 1
name: Retire workflow definitions with no real completions and no live caller
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.220Z
updated_at: "2026-09-16T11:03:28.472Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - retirement
  - adr-076

---

## 0866. Retire workflow definitions with no real completions and no live caller

### Background

config/workflows/ holds 11 definitions. Measured on 2026-09-16 from .spur/spur.db, `basic` (31 runs, 0 done) and `feature-dev` (22 runs, 0 done) record no completion ever; their only recent activity is a single failed sweep on 2026-09-13T06:07 shared with `docs-pipeline`. `docs-pipeline` has exactly one `done`, from 2026-07-04, but is referenced by ADR-071's proof chain and holds a config/pipeline-budgets.json entry, so it is evaluated rather than assumed. Critically, `task-lifecycle` (564 runs) and `feature-lifecycle` (136 runs) must NOT be retired: they are externally driven status FSMs invoked by requestTransition from `spur task` / `spur feature`, and their zero action_runs rows reflect the trace gap closed by task R4, not absent traffic.

### Requirements

- [ ] R1. Retire every definition that records zero runs reaching `done` in the retention window AND has no invoking command, skill, agent, script, or config outside tests and documentation.
- [ ] R2. Refuse retirement for a definition with real traffic, including one driven by requestTransition rather than auto-run actions; report the run count and most recent run that kept it. Absence of action_runs rows is never evidence of absent traffic.
- [ ] R3. Remove each retired definition's config/pipeline-budgets.json entry in the same change.
- [ ] R4. Update docs/design/workflow-composition-contract.md's target inventory dispositions for every definition whose status changes.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R1 — Workflow definitions with no real completions and no live caller are retired
    Given a workflow definition that records zero runs reaching a "done" status within the retention window
    And no command, skill, agent, script, or config outside tests and documentation invokes it
    When the retirement change lands
    Then the definition is removed from config/workflows/
    And its config/pipeline-budgets.json entry is removed with it
    And "spur workflow list" returns only the retained definitions

  @core
  Scenario: R2 — Retirement is refused for an externally driven definition with real traffic
    Given a workflow definition that records runs but no action_runs rows because it is driven by requestTransition rather than by auto-run actions
    When retirement is evaluated for that definition
    Then the definition is retained
    And the evaluation reports the run count and most recent run that kept it
    And absence of action_runs rows is not treated as absence of traffic
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The discriminator is `zero real completions AND no live caller`, not `zero action_runs`. Evaluate each of the 11 definitions against both halves and record the verdict per definition in the task's evidence, including the run counts that justify a retention. Retire by deletion (constitution: delete, don't layer) rather than by deprecation shim — nothing calls these, so no shim has a consumer. `docs-pipeline` gets an explicit evaluated verdict either way; if retained, record what keeps it.

### Plan

1. Query .spur/spur.db for runs, done-count and last-run per workflow_name; record the table.
2. For each candidate, grep for invoking references excluding tests, docs corpus and CHANGELOG.
3. Produce the per-definition verdict table (retire / retain + reason).
4. Delete retired YAML files and their pipeline-budgets entries.
5. Update the workflow-composition-contract inventory dispositions.
6. Run spur workflow list and the project gate; confirm no dangling reference.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
