---
schema_version: 1
name: Delete the inline bookkeeping verbs and parity scripts
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.821Z
updated_at: "2026-10-17T16:13:53.140Z"
feature_id: D65
priority: P2
tags:
  - workflow
  - cleanup
  - cli
estimate_hours: 3

dependencies: ["1241"]
---

## 1242. Delete the inline bookkeeping verbs and parity scripts

### Background

Feature D65 P3 exit, ADR-140 consequence. Once no workflow uses the inline driver, `spur workflow inline *` (11 sub-verbs), scripts/commands/inline-pipeline-parity-check.ts(+test) and inline-execution-contract.test.ts are dead; ADR-051 lists `workflow inline` as deleted, not migrated.

**Refine corrections (2026-10-17)**
- R1 "docs/plugin references" unenumerated → inline consumers: plugins/sp/skills/spur-dev/references/structured-trace-emission.md, inline-pipeline-driver.md, commands dev-idea/dev-plan/dev-run/dev-runall, parallel-execution/references/dispatch-surface.md, spur-cli/references/workflows.md, spec-decomposition/references/decomposition.md.

### Requirements

- [ ] R1. Remove `spur workflow inline` and its sub-verbs, scripts/commands/inline-pipeline-parity-check.ts(+test) and inline-execution-contract.test.ts.
- [ ] R2. Remove or rewrite the inline consumers: spur-dev references structured-trace-emission.md and inline-pipeline-driver.md, commands dev-idea/dev-plan/dev-run/dev-runall, parallel-execution/references/dispatch-surface.md, spur-cli/references/workflows.md, spec-decomposition/references/decomposition.md.
- [ ] R3. Remove the ADR-071 proof-digest machinery not already removed by 1239.
- [ ] R4. Public-surface removal is confirmed by the operator before merge (ADR-051 consent); spur-check-feature passes.

### Acceptance Criteria

- [ ] AC1 — Remaining workflows migrate and the inline bookkeeping surface is removed (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Deletion only, after migration lands. grep every caller (plugins/sp, docs, scripts, tests) before deleting.

### Plan

- [ ] Inventory callers
- [ ] Delete + update references
- [ ] Run spur-check-feature

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History
