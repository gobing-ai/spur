---
schema_version: 1
name: "Align workflow resume identity and checkpoint freshness with persisted runs"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.363Z
updated_at: "2026-09-06T18:27:45.363Z"
feature_id: D6
priority: P1
---

## 0784. Align workflow resume identity and checkpoint freshness with persisted runs

### Background

Audit 0781 F-05: continuePaused resolves only row.workflow_name, so an arbitrary launch path is lost. validateResumeCheckpointFreshness compares checkpoint pending/running literally with persisted paused; checkpointStaleness is called without current HEAD or cwd-rooted artifact probes. Canonical writer conventions omit paused. Many workflow writers still emit noncanonical one-line checkpoints. This leaves task 0752 R5 and ADR-099 coverage incomplete.

### Requirements

- [ ] R1. Persist the existing resolved launch path/layer with definition identity and resume that source; handle legacy name-only rows explicitly. Refuse definition drift unless explicit consent and keep executed versus original identity honest after consent.
- [ ] R2. Define one mapping between engine paused state and canonical checkpoint status; valid unchanged paused checkpoints resume, stale commit/workflow/artifact identities fail with named reasons. Resolve artifact paths against workflow cwd, not ambient process cwd.
- [ ] R3. Align shipped checkpoint writers/consumers or remove redundant noncanonical advisory writes; preserve malformed files during cleanup. Add real pause/resume tests including arbitrary paths and different ambient cwd.

### Acceptance Criteria

```gherkin
Feature: Reliable workflow resume
  Scenario: R1 — Explicit-path runs resume the launched definition
    Given a paused run launched from an arbitrary filename
    When it resumes without source drift
    Then its original definition is found and resumed
    And altered definitions require explicit consent
  Scenario: R2 — Checkpoint freshness respects run state and workdir
    Given a valid paused checkpoint with unchanged HEAD and existing workdir-relative artifacts
    When resume is requested from another ambient directory
    Then the checkpoint is accepted
    And stale HEAD or missing artifacts are rejected with a named reason
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Own packages/app/src/services/workflow-service.ts, packages/app/src/workflow/checkpoint-contract.ts, affected workflow writers and canonical checkpoint guidance. Reuse RunDao metadata, shared resolver and existing parser; no registry, migration engine or second checkpoint store. Preserve legacy unknown identity and authoritative persisted run/task state. Update docs/04_DESIGN.md and workflow-observability.md. Use isolated in-memory DB/temporary git fixtures; never mutate live runs.

### Plan

- [ ] Add failure reproductions for explicit-path and pending-versus-paused resume.
- [ ] Persist source identity and supply actual freshness inputs at the shared seam.
- [ ] Align only affected writers and parity tests; verify legacy and drift cases.

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
