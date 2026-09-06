---
schema_version: 1
name: "Remove stale corpus-sweep and task-record instructions from canonical capability sources"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.428Z
updated_at: "2026-09-06T18:36:00.653Z"
feature_id: D6
priority: P2
---

## 0786. Remove stale corpus-sweep and task-record instructions from canonical capability sources

### Background
Audit 0781 F-08: plugins/sp/agents/expert-spur.md still mandates a corpus sweep after every batch despite constitution T11 and ADR-108. plugins/sp/skills/spur-cli/references/tasks.md says task record never transitions done, contradicting TaskRecordService's done target. Installed skill copies repeat these statements. This causes unnecessary audits and wrong lifecycle routing. Canonical spur-dev/references/gate-checklists.md:152 also still describes a docs PASS stub, although docs-pipeline.yaml:118 uses measured read-only verification.
### Requirements
- [ ] R1. Replace the canonical expert-spur routine corpus-sweep mandate with affected-input checks; retain explicit T10 checker-policy audits.
- [ ] R2. Correct the task-record reference to the actual guarded transition and provenance semantics without duplicating a second catalog; correct the gate checklist's removed docs PASS-stub claim.
- [ ] R3. Validate canonical capability edits through Superskill and focused plugin contracts; generated adapters are updated only through the installer with explicit installation scope. Record any remaining installed-version skew.
### Acceptance Criteria

```gherkin
Feature: Current workflow capability instructions
  Scenario: R1 — Capability guidance follows current corpus and record owners
    Given the canonical expert-spur and task-record guidance
    When their instructions are checked against T11 and TaskRecordService
    Then ordinary batch edits do not trigger a corpus sweep
    And guarded record-to-done support is documented correctly
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Own plugins/sp/agents/expert-spur.md and plugins/sp/skills/spur-cli/references/tasks.md and plugins/sp/skills/spur-dev/references/gate-checklists.md plus only their focused contract tests. Use Superskill lifecycle for capability source changes; no raw generated adapter edits. Current constitution and CLI source outrank stale installed instructions. Do not change live command semantics or install into host config without scoped authority.
### Plan
- [ ] Verify current leaf CLI help/source and Superskill lifecycle.
- [ ] Repair the canonical projections and focused contracts.
- [ ] Record installer validation or explicitly pending install scope.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
