---
schema_version: 1
name: Reconcile superseded authority across ADRs, architecture, and templates
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-12T04:56:47.219Z"
feature_id: G64
priority: P3
tags:
  - g6-program

dependencies: ["0848", "0849"]
---

## 0850. Reconcile superseded authority across ADRs, architecture, and templates

### Background

ADR-052 records team-scoped composition, which this program replaces with project-scoped fleets.
Leaving it unsuperseded leaves two contradictory authorities in the tree, which the constitution's
"fix authority first, then derived docs" rule forbids.

Neighbouring ADRs stay: ADR-037 (registry) and ADR-057 (control-plane boundary) remain correct, and
ADR-022 keeps task lifecycle. Historical ADRs and feature receipts are not rewritten — supersession is
recorded, not retconned.

Derived owners then follow: `docs/03_ARCHITECTURE.md`, the owning design satellites, CLI references
under `plugins/sp/skills/spur-cli/references/`, init templates, and plugin callers.

### Requirements

- **R1** — ADR-052's supersession is recorded in `docs/00_ADR.md` with its replacement decision.
- **R2** — ADR-037, ADR-057, and ADR-022 are explicitly retained; no historical ADR or feature receipt
  is rewritten.
- **R3** — `docs/03_ARCHITECTURE.md`, owning design satellites, CLI references, init templates, and
  plugin callers match the shipped surface.
- **R4** — Portable changes propagate to init templates, not just this repository's docs.
- **R5** — Only owners whose facts changed are touched.

### Acceptance Criteria

```gherkin
Feature: Reconcile superseded authority

  @core
  Scenario: Superseded authority is corrected at its owner
    Given ADR-052's team-scoped composition no longer holds
    When this feature completes
    Then the supersession is recorded in docs/00_ADR.md with its replacement
    And architecture, design satellites, CLI references, and init templates match the shipped surface

  @core
  Scenario: History is preserved
    Given historical ADRs and feature receipts
    When the supersession is recorded
    Then no historical decision or receipt is rewritten
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Authority owners: `docs/00_ADR.md` (ADR-052 superseded; ADR-037, ADR-057, ADR-022 retained)
- Derived owners: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md` and `docs/design/`, `plugins/sp/skills/spur-cli/references/`, init templates
- Process: `docs/99_PROJECT_CONSTITUTION.md` placement guard

### History
