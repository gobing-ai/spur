---
schema_version: 1
name: Move the remaining canonical workflows to the run record
status: todo
template: feature-impl
created_at: 2026-09-23T05:09:42.309Z
updated_at: "2026-09-23T05:19:49.446Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - workflow-adoption
estimate_hours: 8

dependencies: ["0927"]
---

## 0928. Move the remaining canonical workflows to the run record

### Background

Covers the remaining E7 R4 caller set after the task-pipeline slice. Current idea, feature verification, lifecycle, wrapup, history, PR review, and wayfinder workflows reference `.spur/run`; many of those files are independent proof or transient workflow outputs. The final reader/writer inventory must be taken after D63. Depends on task-pipeline migration so the shared installed/plugin seam is stable. Rubric: E8 D1 L2 C2 R1 = 14; these workflow files are independent from the task-pipeline proof review but share one migration contract.

**Refine corrections (2026-09-22)**
- Original wording could imply every `.spur/run` reference should move → the current canonical YAML includes WBS-keyed verdicts, status gates, learning captures, and other non-record artifacts → require an ownership table and audited no-change dispositions before touching each workflow.

### Requirements

- [ ] R1. Classify every remaining canonical workflow's `.spur/run` artifacts as run record, independent evidence, or transient output using the post-D63 source and installed catalog.
- [ ] R2. Migrate run-record-owned readers/writers to the shared pair without changing each workflow's guard, human decision, retry, or external-effect behavior.
- [ ] R3. Keep independent task/feature proof, history outputs, trace-file output, and project-owned overrides at their existing owners; never overwrite an override.
- [ ] R4. Check source and installed resolution, interruption/replay, terminal status, and absence of undeclared run-record sidecars for every affected workflow.

### Acceptance Criteria

- [ ] AC1 — Current callers survive the storage migration (req: R1)
  Given the post-D63 source and installed catalog for every remaining canonical workflow
  When each workflow's run-directory writers and readers are classified and record-owned sites are migrated
  Then independent proof and transient outputs retain their owners, every affected workflow uses the shared pair, and no undeclared run-record sidecar remains
  And source, installed, resumed, and project-override resolution preserve their guards, decisions, trace status, and external-effect identity
  Verify with an inventory table and focused workflow fixtures for each changed definition; do not count unrelated proof files as pair violations.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: 0927 establishes the installed/plugin pair seam; 0921 supplies the final D63 catalog. Take a fresh catalog inventory before editing. If an item is independent evidence or transient output, record that disposition and leave it in place.
- Inventory scope: inspect `idea-pipeline.yaml`, `feature-verification.yaml`, `feature-lifecycle.yaml`, `task-lifecycle.yaml`, `wrapup-pipeline.yaml`, `history-anatomy.yaml`, `pr-review.yaml`, and `wayfinder-resolution.yaml` plus any post-D63 canonical definition and directly corresponding plugin scripts. Classify each `.spur/run` producer and its last reader in a reviewable table; the inventory, not a blanket filename count, determines edits.
- Migration: use the 0925–0927 pair seam only for genuinely record-owned sites. Preserve each workflow's guard ordering, human decisions, retry policy, external-effect identity, trace status, and project override precedence. A workflow with no record-owned site needs no code edit; record its audited no-change outcome.
- Primary targets: affected `config/workflows/*.yaml`, their direct plugin scripts/tests, and owning workflow design/catalog docs. Keep task-pipeline, Board, independent proof, history products, and explicit trace-file output out of this slice. No new public CLI/API.
- Anti-patterns: no universal replacement workflow, no duplicate state store, no mass sidecar deletion, and no overwrite of project-owned definitions.

### Plan

1. Freeze the post-D63 resolved catalog and enumerate each remaining workflow's run-directory readers and writers.
2. Convert record-owned sites in small workflow groups, keeping independent evidence untouched.
3. Validate each affected workflow, run representative source/installed dry and resumed cases, and compare authoritative traces.
4. Remove only obsolete run-record sidecars and update the design/catalog disposition.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md); D63 final catalog is owned by [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md).
- D63 is active in a separate worktree at refinement time. Recheck the merged canonical catalog, generated bundle, and project-override resolution before inventory or edits.

### History
