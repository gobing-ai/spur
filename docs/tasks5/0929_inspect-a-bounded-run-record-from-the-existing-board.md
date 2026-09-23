---
schema_version: 1
name: Inspect a bounded run record from the existing Board
status: todo
template: feature-impl
created_at: 2026-09-23T05:09:42.309Z
updated_at: "2026-09-23T05:21:42.912Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - board
estimate_hours: 8

dependencies: ["0926"]
---

## 0929. Inspect a bounded run record from the existing Board

### Background

Covers E7 R5. The current Board has History Tool Using and Observability System Events, while the Observability Tasks tab already has a run-detail panel but no run-record read. This slice depends on the core writer and the legacy-compatible application reader delivered by 0926; it can run alongside workflow adoption once 0926 lands. Rubric: E8 D1 L3 C1 R2 = 15; a remotely reachable file read needs its own security and UI review.

**Refine corrections (2026-09-22)**
- Original Requirements requested an explicit `expired` outcome for absent records → current `cleanRunLogs()` deletes `.log` without a tombstone and the new pair has no retention policy → reserve `expired` for cases with persisted cleanup evidence, otherwise report `missing`.

### Requirements

- [ ] R1. Add a read-only run-record request under the existing Observability server/application boundary using a validated run ID and project-root confinement, rejecting traversal and symlink escapes.
- [ ] R2. Bound output size and return explicit missing, legacy, incomplete, and oversized outcomes without exposing unredacted source files or treating a partial log as done. Label an absent record `expired` only if reliable persisted cleanup evidence exists; absence alone is not proof of expiration.
- [ ] R3. Link the record from the existing Observability Tasks run detail; preserve keyboard and screen-reader access and show actual trace-derived status.
- [ ] R4. Reuse existing Board/API ownership; add no History module, Tool Using tab, or new public `spur` noun/verb.

### Acceptance Criteria

- [ ] AC1 — Operators inspect the record by run ID (req: R1)
  Given a valid run, a malformed ID, an absent or legacy record, an incomplete pair, and an oversized or symlinked file
  When an operator opens the record from the existing Board Tasks run detail
  Then the server returns a bounded redacted projection or an explicit unavailable outcome without reading outside the project run directory
  And the accessible view shows DB-trace status rather than inferring success from log text
  And it labels a record expired only when retained cleanup evidence proves that disposition; otherwise an absent file is missing
  Verify application and server path-confinement tests with real files, plus keyboard and screen-reader UI checks in the existing Tasks run detail.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: reuse 0926's legacy-compatible application reader and 0925's redacted pair; do not create a second file parser or storage format. This Board slice can follow 0926 independently of 0927/0928.
- Surface: add the narrow read under the existing Observability application/server boundary and link from `apps/web/src/modules/observability/TasksTab.tsx` run detail, which already fetches `/runs/:runId`. Use the existing contracts package for any transport DTO. No History contract, Tool Using tab, new Board module, or public `spur` verb.
- Trust boundary: accept a validated run ID only, resolve beneath the selected project's `.spur/run`, reject traversal and symlink escapes, and cap bytes before returning content. Return an explicit discriminated outcome for present pair, legacy-only, missing, incomplete/corrupt state, and oversized content. Use `expired` only when persisted cleanup evidence establishes it; the current `.log` cleaner leaves no tombstone, so absence alone cannot prove expiration. Re-redact legacy text on read and never return raw source files. Use DB trace for status; never infer completion from a log tail.
- UI: show an accessible link/detail action, loading/error/partial states, and actual trace status in the existing Tasks run detail. Keep keyboard focus and screen-reader labels. Follow current Board API error conventions.
- Primary targets: `packages/app` workflow reader, `apps/server/src/modules/observability/index.ts`, `packages/contracts/src/observability.ts` if needed, `apps/web/src/modules/observability/TasksTab.tsx`, and focused service/API/UI tests. The narrow Observability read route is the only new HTTP surface; no new public CLI verb.
- Anti-patterns: no arbitrary-path API, unbounded text response, status inferred from state/log, duplicate History route, or new Tool Using view.

### Plan

1. Specify the smallest response shape for redacted log text, state summary, and explicit unavailable outcomes.
2. Implement the confined application read and server route; cover traversal, symlink, oversized, absent, and legacy cases.
3. Add the existing-surface Board link/detail view with accessible loading/error/partial states.
4. Check source/installed run IDs and confirm the route never serves a sibling project's file.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0926](0926_continue-and-inspect-legacy-workflow-runs-with-stable-identi.md); its Board surface is the existing [Observability Tasks run detail](../../apps/web/src/modules/observability/TasksTab.tsx).
- D63 is active in a separate worktree at refinement time. Recheck merged run ID and project resolution behavior, plus the completed 0926 reader, before implementation.

### History
