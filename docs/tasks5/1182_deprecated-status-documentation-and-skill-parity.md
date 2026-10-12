---
schema_version: 1
name: Deprecated status documentation and skill parity
status: todo
template: meta
created_at: 2026-10-12T05:21:53.041Z
updated_at: "2026-10-12T05:22:39.130Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - docs

dependencies: ["1180", "1181"]
---

## 1182. Deprecated status documentation and skill parity

### Background

Implements: R7 — Owning documents and skills describe the deprecated status and its affected surfaces.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S15–S16.

### Requirements

- [ ] R1. `planning-record-contracts.md` §7.3.3, `rd3-migration-design.md` §2.3, `planning-workflow-contracts.md`, `e2e-workflow-for-system-development.md` and `03_ARCHITECTURE.md` name deprecated with its edges and freeze semantics.
- [ ] R2. `plugins/sp/skills/spur-cli/references/features.md`, `features/verbs.md` and `spur-dev/references/dev-operations.md` document the status, guards and advance refusal.
- [ ] R3. ADR-136 moves to Accepted and the design satellite to current; the seeded feature-lifecycle template matches the source graph.
- [ ] R4. Release note: project-layer `feature-lifecycle.yaml` overrides must be re-synced.

### Acceptance Criteria

- [ ] AC1 — Owning documents and skills describe the deprecated status and its affected surfaces

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Update owners only where facts changed (constitution §5); docs follow shipped behavior, so this runs last.

### Plan

- Design satellites + 03
- spur-cli / spur-dev references
- ADR status + satellite status
- sp:doc-evolve drift check

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
